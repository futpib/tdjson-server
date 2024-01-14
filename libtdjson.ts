import { dlopen, FFIType, suffix } from "bun:ffi";

const {
	TDJSON_SERVER_LIBTDJSON_PATH = `libtdjson.${suffix}`,
} = process.env;

export const libtdjson = dlopen(TDJSON_SERVER_LIBTDJSON_PATH, {
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
