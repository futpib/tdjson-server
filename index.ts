import debug from 'debug';
import { EventEmitter } from "events";
import { Tdjson, type Request as TdjsonRequest } from 'tdjson';

const log = debug('tdjson-server').extend('TdjsonClient');

export class TdjsonClientError extends Error {
	constructor(message: string) {
		super(message);
	}
}

export class TdjsonRequestError extends TdjsonClientError {
	constructor(
		message: string,
		public readonly request: TdjsonRequest,
	) {
		super(message);
	}
}

export class TdjsonRequestTimeoutError extends TdjsonRequestError {}

export class TdjsonClient extends Tdjson {
	private readonly _serverBaseUrl: URL;
	private readonly _clientKey: string;
	private readonly _requestTimeout: number;

	private readonly _eventEmitter = new EventEmitter();

	private _webSocket: undefined | WebSocket;
	private _webSocketSendQueue: string[] = [];
	private _unsubscribeFromWebSocketOpen: undefined | (() => void);
	private _unsubscribeFromWebSocketMessage: undefined | (() => void);
	private _unsubscribeFromWebSocketError: undefined | (() => void);
	private _unsubscribeFromWebSocketClose: undefined | (() => void);

	constructor({
		serverBaseUrl,
		clientKey,
		requestTimeout = 10000,
	}: {
		serverBaseUrl: string | URL;
		clientKey: string;
		requestTimeout?: number;
	}) {
		super();

		this._serverBaseUrl = new URL(serverBaseUrl.toString());
		this._clientKey = clientKey;
		this._requestTimeout = requestTimeout;
	}

	start() {
		if (this._webSocket) {
			return;
		}

		const serverUrl = new URL(this._serverBaseUrl.toString());
		serverUrl.searchParams.set('clientKey', this._clientKey);

		this._webSocket = new WebSocket(serverUrl.toString());

		const handleMessage = (message: MessageEvent) => {
			log('Received message', message.data)
			this._eventEmitter.emit('message', message.data);
		};

		const handleError = (event: ErrorEvent) => {
			log('Received error', event.error);
			console.error(event.error);
			throw event.error;
		};

		const handleOpen = () => {
			log('Opened');
			this._sendQueuedMessages();
		}

		const handleClose = (event: CloseEvent) => {
			this.stop();

			if (event.code !== 1000) {
				this.start();
			}
		}

		this._webSocket!.addEventListener('message', handleMessage);
		this._webSocket!.addEventListener('error', handleError);
		this._webSocket!.addEventListener('open', handleOpen);
		this._webSocket!.addEventListener('close', handleClose);

		this._unsubscribeFromWebSocketMessage = () => {
			this._webSocket!.removeEventListener('message', handleMessage);
		};

		this._unsubscribeFromWebSocketError = () => {
			this._webSocket!.removeEventListener('error', handleError);
		};

		this._unsubscribeFromWebSocketOpen = () => {
			this._webSocket!.removeEventListener('open', handleOpen);
		};

		this._unsubscribeFromWebSocketClose = () => {
			this._webSocket!.removeEventListener('close', handleClose);
		};
	}

	stop() {
		if (!this._webSocket) {
			return;
		}

		this._unsubscribeFromWebSocketOpen!();
		this._unsubscribeFromWebSocketOpen = undefined;

		this._unsubscribeFromWebSocketMessage!();
		this._unsubscribeFromWebSocketMessage = undefined;

		this._unsubscribeFromWebSocketError!();
		this._unsubscribeFromWebSocketError = undefined;

		this._unsubscribeFromWebSocketClose!();
		this._unsubscribeFromWebSocketClose = undefined;

		this._webSocket.close(1000);
		this._webSocket = undefined;
	}

	private async _sendQueuedMessages(): Promise<void> {
		while (this._webSocketSendQueue.length > 0) {
			const message = this._webSocketSendQueue.shift()!;

			log('Sending queued message', message);
			this._webSocket!.send(message);
		}
	}

	private async _send(message: string): Promise<void> {
		await this.start();

		if (this._webSocket!.readyState === WebSocket.CONNECTING) {
			this._webSocketSendQueue.push(message);

			return;
		}

		this._sendQueuedMessages();

		log('Sending message', message);
		this._webSocket!.send(message);
	}

	protected async _request<R extends TdjsonRequest>(messageRaw: R): Promise<any> {
		this.start();

		const requestId = Math.random().toString(36).slice(2);

		const message = {
			...messageRaw,
			'@extra': {
				...(messageRaw as any)['@extra'],
				requestId,
			},
		};

		const messageString = JSON.stringify(message);

		await this._send(messageString);

		const response = await new Promise<any>((resolve, reject) => {
			const timeout = setTimeout(() => {
				this._eventEmitter.removeListener('message', handleMessage);

				reject(new TdjsonRequestTimeoutError('Request timed out', message));
			}, this._requestTimeout);

			const handleMessage = (messageRaw: unknown) => {
				if (typeof messageRaw !== 'string') {
					throw new Error('Expected message to be a string');
				}

				const message = JSON.parse(messageRaw);

				if (message['@extra']?.requestId !== requestId) {
					return;
				}

				clearTimeout(timeout);
				this._eventEmitter.removeListener('message', handleMessage);

				resolve(message);
			};

			this._eventEmitter.on('message', handleMessage);
		});

		return response;
	}
}
