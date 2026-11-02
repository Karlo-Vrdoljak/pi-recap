import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import recap from "../extensions/recap.ts";

const response = (text, stopReason = "stop") => ({ content: [{ type: "text", text }], stopReason });
const deferred = () => {
	let resolve, reject;
	const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
	return { promise, resolve, reject };
};
async function until(predicate) {
	for (let i = 0; i < 100; i++) {
		if (predicate()) return;
		await setImmediate();
	}
	assert.fail("Background recap did not settle");
}
function setup({ settings = {}, entries = [], hasUI = true, generate = () => response("Short useful recap"), available = true } = {}) {
	const handlers = new Map();
	const calls = [], statuses = new Map(), notices = [], titles = [];
	const branch = [...entries];
	const pi = {
		on: (name, handler) => handlers.set(name, handler),
		getSettings: () => settings,
		appendEntry: (customType, data) => branch.push({ type: "custom", customType, data }),
	};
	const ctx = {
		hasUI,
		cwd: "/not/a/trusted/project",
		sessionManager: { getBranch: () => branch },
		modelRegistry: {
			find: (provider, id) => available ? { provider, id } : undefined,
			hasConfiguredAuth: () => available,
			getApiKeyAndHeaders: () => assert.fail("Extension must not access credentials"),
			streamSimple(model, context, options) {
				const call = { model, context, options };
				calls.push(call);
				return { result: () => Promise.resolve().then(() => generate(call, calls.length)) };
			},
		},
		ui: {
			setStatus: (key, value) => value ? statuses.set(key, value) : statuses.delete(key),
			setTitle: (value) => titles.push(value),
			notify: (text, type) => notices.push({ text, type }),
		},
	};
	recap(pi);
	const emit = (name, event = {}, context = ctx) => handlers.get(name)?.({ type: name, ...event }, context);
	emit("session_start");
	const user = (text) => {
		const message = { role: "user", content: text };
		branch.push({ type: "message", message });
		return emit("message_end", { message });
	};
	const finish = (text = "Task completed", stopReason = "stop") => {
		branch.push({ type: "message", message: { role: "assistant", ...response(text, stopReason) } });
		return emit("agent_settled", { aborted: false });
	};
	return { emit, user, finish, calls, statuses, notices, titles, ctx, branch };
}
const saved = (data) => ({ type: "custom", customType: "pi-recap", data });

test("uses Luna and the registry, stays nonblocking, and generates a six-word title only once", async () => {
	const h = setup({ generate: (_call, n) => response(n === 2 ? "Safe short recap fork" : "Installed a short safe recap in the footer") });
	assert.equal(h.calls.length, 0);
	assert.equal(h.user("Build recap"), undefined);
	assert.equal(h.calls.length, 0, "No LLM call on user input");
	assert.equal(h.finish(), undefined, "The settlement hook must not wait for the network");
	await until(() => h.titles.length === 1);
	assert.equal(h.calls.length, 2);
	assert.deepEqual(h.calls[0].model, { provider: "openai-codex", id: "gpt-6-luna" });
	const { options } = h.calls[0];
	assert.equal(options.reasoning, undefined, "Omitting reasoning selects Pi's off/default mode");
	assert.equal(options.maxTokens, 256);
	assert.equal(options.timeoutMs, 15000);
	assert.equal(options.maxRetries, 0);
	assert.equal(options.transport, "sse");
	assert.equal(options.apiKey, undefined);
	assert.equal(h.statuses.get("pi-recap"), "※ Recap: Installed a short safe recap in the footer");
	await setImmediate();
	h.emit("agent_settled", { aborted: false });
	assert.equal(h.calls.length, 2, "Identical exchange must not regenerate");
	h.user("Do another thing");
	h.finish("Second thing done");
	await until(() => h.calls.length === 3);
	await setImmediate();
	assert.equal(h.calls.length, 3, "No repeated title call");
	assert.deepEqual(h.notices, []);
});

test("caps output at 14 words and 160 characters and strips terminal control sequences", async () => {
	const h = setup({ entries: [saved({ title: "Existing title" })], settings: { recap: { maxWords: 100 } },
		generate: () => response('\x1b]52;c;c2VjcmV0\x07\x1b[31mRecap: one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen\x1b[0m\nUnwanted second line') });
	h.user("request");
	h.finish();
	await until(() => h.statuses.has("pi-recap"));
	const text = h.statuses.get("pi-recap").replace("※ Recap: ", "");
	assert.equal(text, "one two three four five six seven eight nine ten eleven twelve thirteen fourteen");
	assert.equal(text.split(/\s+/).length, 14);
	assert.ok(!/[\x00-\x1f\x7f-\x9f]/.test(text));
	const long = setup({ entries: [saved({ title: "Existing title" })], generate: () => response("長".repeat(400)) });
	long.user("request"); long.finish();
	await until(() => long.statuses.has("pi-recap"));
	assert.equal(long.statuses.get("pi-recap").replace("※ Recap: ", "").length, 160);
});

test("sends only bounded request and answer text, not tools, thinking, or images", async () => {
	const h = setup({ entries: [saved({ title: "Existing title" })] });
	h.user([{ type: "text", text: "u".repeat(9000) }, { type: "image", data: "PRIVATE_IMAGE" }]);
	h.branch.push({ type: "message", message: { role: "toolResult", content: "PRIVATE_TOOL_RESULT" } });
	h.branch.push({ type: "message", message: { role: "assistant", stopReason: "stop", content: [
		{ type: "thinking", thinking: "PRIVATE_THINKING" }, { type: "text", text: "a".repeat(9000) },
	] } });
	h.emit("agent_settled", { aborted: false });
	await until(() => h.statuses.has("pi-recap"));
	assert.equal(h.calls[0].context.messages[0].content, `Request:\n${"u".repeat(2000)}\n\nResult:\n${"a".repeat(2000)}`);
	assert.ok(!JSON.stringify(h.calls).includes("PRIVATE_"));
});

test("new input cancels in-flight work, including a provider that ignores cancellation", async () => {
	const old = deferred();
	const h = setup({ entries: [saved({ title: "Existing title" })], generate: (_call, n) => n === 1 ? old.promise : response("New result") });
	h.user("old request"); h.finish("old answer");
	await setImmediate();
	const signal = h.calls[0].options.signal;
	h.user("new request");
	assert.equal(signal.aborted, true);
	h.finish("new answer");
	await until(() => h.statuses.get("pi-recap") === "※ Recap: New result");
	old.resolve(response("STALE RESULT"));
	await setImmediate();
	assert.equal(h.statuses.get("pi-recap"), "※ Recap: New result");
	assert.deepEqual(h.notices, []);
});

test("shutdown and session replacement abort old work without leaking text or promises", async () => {
	const old = deferred();
	const h = setup({ generate: () => old.promise });
	h.user("old request"); h.finish();
	await setImmediate();
	h.emit("session_shutdown");
	assert.equal(h.calls[0].options.signal.aborted, true);
	h.branch.length = 0;
	h.emit("session_start");
	old.resolve(response("WRONG SESSION"));
	await setImmediate();
	assert.equal(h.statuses.size, 0);
	assert.equal(h.branch.length, 0);
	assert.deepEqual(h.notices, []);
});

test("restores sanitized branch-local state without generating on resume", () => {
	const h = setup({ entries: [saved({ title: "Earlier title", recap: "Earlier recap" }),
		saved({ title: "\x1b[31mCurrent title\x1b[0m", recap: "Current recap\x07", firstPrompt: "request" })] });
	assert.equal(h.statuses.get("pi-recap"), "※ Recap: Current recap");
	assert.deepEqual(h.titles, ["Current title"]);
	assert.equal(h.calls.length, 0);
});

test("errors, incomplete output and invalid settings preserve the last successful recap", async (t) => {
	for (const [name, options] of [
		["provider rejection", { generate: () => { throw new Error("PRIVATE_ERROR"); } }],
		["provider error", { generate: () => response("Bad output", "error") }],
		["length limit", { generate: () => response("Half a sentence", "length") }],
		["empty output", { generate: () => response("") }],
		["missing model", { available: false }],
		["invalid model", { settings: { recap: { model: "invalid" } } }],
		["invalid word limit", { settings: { recap: { maxWords: 0 } } }],
		["invalid prompt", { settings: { recap: { prompts: { recap: 42 } } } }],
	]) await t.test(name, async () => {
		const h = setup({ entries: [saved({ title: "Existing title", recap: "Keep this recap" })], ...options });
		h.user("request"); h.finish();
		await until(() => h.notices.length === 1);
		assert.equal(h.statuses.get("pi-recap"), "※ Recap: Keep this recap");
		assert.equal(h.notices[0].type, "warning");
		assert.ok(!h.notices[0].text.includes("PRIVATE_ERROR"));
	});
});

test("honors shorter trusted limits and model settings without a silent model fallback", async () => {
	const h = setup({ entries: [saved({ title: "Existing title" })], settings: { recap: { model: "custom/model", maxWords: 3 } },
		generate: () => response("One two three four five") });
	h.user("request"); h.finish();
	await until(() => h.statuses.has("pi-recap"));
	assert.equal(h.statuses.get("pi-recap"), "※ Recap: One two three");
	assert.deepEqual(h.calls[0].model, { provider: "custom", id: "model" });
});

test("a timed-out helper result cannot replace the previous recap", async (t) => {
	const requested = [];
	t.mock.method(AbortSignal, "timeout", (milliseconds) => {
		requested.push(milliseconds);
		return AbortSignal.abort(new DOMException("Timeout", "TimeoutError"));
	});
	const h = setup({ entries: [saved({ title: "Existing title", recap: "Keep this recap" })] });
	h.user("request"); h.finish();
	await until(() => h.notices.length === 1);
	assert.deepEqual(requested, [15000]);
	assert.equal(h.statuses.get("pi-recap"), "※ Recap: Keep this recap");
});

test("skips headless, aborted and failed main turns; never reuses an old answer", () => {
	const headless = setup({ hasUI: false });
	headless.user("request"); headless.finish();
	assert.equal(headless.calls.length, 0);
	const h = setup();
	h.user("request");
	h.emit("agent_settled", { aborted: true });
	h.finish("Failure", "error");
	assert.equal(h.calls.length, 0);
	h.user("new request with no answer");
	h.emit("agent_settled", { aborted: false });
	assert.equal(h.calls.length, 0);
});
