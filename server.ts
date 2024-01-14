import debug from 'debug';
import { EventEmitter } from "events";
import { libtdjson } from "./libtdjson";
import type { ServerWebSocket } from "bun";

const {
	TDJSON_SERVER_LISTEN_PORT = '3000',
	TDJSON_SERVER_LISTEN_HOSTNAME = 'localhost',
	TDJSON_SERVER_MAX_RECEIVE_INTERVAL = '100',
	TDJSON_SERVER_LOG_VERBOSITY_LEVEL = '2',
} = process.env;

const log = debug('tdjson-server').extend('server')

type WebSocketData = {
	clientKey: string;
	unsubscribe?: () => void;
};

function tdExecute(json: string) {
	const string = libtdjson.symbols.td_execute(Buffer.from(json + '\0', 'utf8'));

	if (!string) {
		throw new Error('Failed to execute');
	}

	return Buffer.from(string).toString('utf8');
}

function tdSend(clientId: number, json: string) {
	libtdjson.symbols.td_send(clientId, Buffer.from(json + '\0', 'utf8'));
}

function tdReceive(timeout: number) {
	const cstring = libtdjson.symbols.td_receive(timeout);

	return Buffer.from(cstring).toString('utf8');
}

if (!debug.enabled('tdjson-server')) {
	const logVerbosityLevelResponse = JSON.parse(tdExecute(JSON.stringify({
		"@type": "setLogVerbosityLevel",
		"new_verbosity_level": TDJSON_SERVER_LOG_VERBOSITY_LEVEL,
	})));

	if (logVerbosityLevelResponse["@type"] !== "ok") {
		throw new Error('Failed to set log verbosity level');
	}
}

const eventEmitter = new EventEmitter();

const clientIdByClientKey = new Map<string, number>();

function getWebSocketClientId(websocket: ServerWebSocket<WebSocketData>) {
	const { clientKey } = websocket.data;

	if (!clientIdByClientKey.has(clientKey)) {
		const clientId = libtdjson.symbols.td_create_client_id();
		clientIdByClientKey.set(clientKey, clientId);
	}

	return clientIdByClientKey.get(clientKey)!;
}

const server = Bun.serve<WebSocketData>({
	hostname: TDJSON_SERVER_LISTEN_HOSTNAME,
	port: Number.parseInt(TDJSON_SERVER_LISTEN_PORT, 10),

	fetch(request, server) {
		log('Received request', request.url);

		const clientKey = new URL(request.url).searchParams.get('clientKey');

		if (!clientKey) {
			return new Response("No client key", {
				status: 400,
			});
		}

		const success = server.upgrade(request, {
			data: {
				clientKey,
			},
		});

		if (success) {
			return undefined;
		}

		return new Response("", {
			status: 400,
		});
	},

	websocket: {
		async open(websocket) {
			const clientId = getWebSocketClientId(websocket);

			log('Client connected', clientId);

			const handleReceive = (string: string) => {
				const message = JSON.parse(string);

				if (message['@client_id'] && message['@client_id'] !== clientId) {
					return;
				}

				log('Sending message', string);
				websocket.send(string);
			}

			eventEmitter.on('receive', handleReceive);

			websocket.data.unsubscribe = () => {
				eventEmitter.off('receive', handleReceive);
			};
		},

		async message(websocket, message) {
			if (typeof message !== 'string') {
				throw new Error('Message is not a string');
			}

			log('Received message', message);

			const clientId = getWebSocketClientId(websocket);

			tdSend(clientId, message);
		},

		async close(websocket) {
			const clientId = getWebSocketClientId(websocket);

			log('Client disconnected', clientId);

			websocket.data.unsubscribe?.();
		},
	},
});

log('Listening on', server.hostname, server.port);

let lastReceived = Date.now();

while (true) {
	await new Promise(resolve => {
		const delay = Math.max(0, Math.min(Number.parseInt(TDJSON_SERVER_MAX_RECEIVE_INTERVAL, 10), Date.now() - lastReceived));
		log('Waiting', delay);
		setTimeout(resolve, delay);
	});

	const string = tdReceive(0);

	if (!string) {
		continue;
	}

	lastReceived = Date.now();

	eventEmitter.emit('receive', string);
}
