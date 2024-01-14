import type { Subprocess } from "bun";
import { expect, test, beforeAll, afterAll } from "bun:test";
import { TdjsonClient } from ".";

let serverProcess: Subprocess;

beforeAll(() => {
	serverProcess = Bun.spawn([ "bun", "server.ts" ], {
		stdio: [ "inherit", "inherit", "inherit" ],
	});
});

afterAll(() => {
	serverProcess.kill();
});

test('test', async () => {
	const client = new TdjsonClient({
		clientKey: 'test',
		serverBaseUrl: 'ws://localhost:3000',
		requestTimeout: 1000,
	});

	let clientId: number;

	{
		const authorizationState = await client.getAuthorizationState();

		expect(authorizationState["@type"]).toBe("authorizationStateWaitTdlibParameters");
		clientId = (authorizationState as any)["@client_id"];
	}

	client.stop();
	client.start();

	{
		const authorizationState = await client.getAuthorizationState();

		expect(authorizationState["@type"]).toBe("authorizationStateWaitTdlibParameters");
		expect((authorizationState as any)["@client_id"]).toBe(clientId);
	}
});
