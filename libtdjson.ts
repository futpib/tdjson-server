import { dlopen, FFIType, suffix } from "bun:ffi";

const path = `libtdjson.${suffix}`;

export const libtdjson = dlopen(path, {
	td_create_client_id: {
		args: [],
		returns: FFIType.int,
	},

	td_send: {
		args: [
			FFIType.int,
			FFIType.cstring,
		],
		returns: FFIType.void,
	},

	td_receive: {
		args: [
			FFIType.double,
		],
		returns: FFIType.cstring,
	},

	td_execute: {
		args: [
			FFIType.cstring,
		],
		returns: FFIType.cstring,
	},
});
