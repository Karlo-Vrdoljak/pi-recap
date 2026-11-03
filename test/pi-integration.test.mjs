import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

test("installed Pi loads the package and excludes denied project settings", { skip: !process.env.PI_RECAP_INTEGRATION }, async () => {
	const cli = realpathSync(process.env.PI_TEST_CLI ?? fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")));
	const dist = new URL(cli.endsWith("/bundle/cli.js") ? "../" : "./", pathToFileURL(cli));
	const { SettingsManager } = await import(new URL("index.js", dist));
	const { loadExtensions } = await import(new URL("core/extensions/loader.js", dist));
	const dir = mkdtempSync(join(tmpdir(), "pi-recap-trust-"));
	try {
		const agentDir = join(dir, "agent");
		mkdirSync(agentDir);
		mkdirSync(join(dir, ".pi"));
		writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ recap: { model: "openai-codex/gpt-6-luna", maxWords: 3 } }));
		writeFileSync(join(dir, ".pi/settings.json"), JSON.stringify({ recap: { model: "other-provider/private-model", maxWords: 100 } }));
		const settings = SettingsManager.create(dir, agentDir, { projectTrusted: false });
		const loaded = await loadExtensions([fileURLToPath(new URL("../extensions/recap.ts", import.meta.url))], dir);
		assert.deepEqual(loaded.errors, []);
		loaded.runtime.getSettings = () => settings.getSettings();
		const branch = [], calls = [], statuses = new Map();
		loaded.runtime.appendEntry = (customType, data) => branch.push({ type: "custom", customType, data });
		const ctx = {
			hasUI: true, cwd: dir,
			sessionManager: { getBranch: () => branch },
			modelRegistry: {
				find: (provider, id) => ({ provider, id }),
				hasConfiguredAuth: () => true,
				streamSimple: (model) => {
					calls.push(model);
					return { result: async () => ({ stopReason: "stop", content: [{ type: "text", text: JSON.stringify({ goal: "Summarize safely", recap: "One two three four" }) }] }) };
				},
			},
			ui: {
				setTitle() {},
				setStatus: (key, value) => statuses.set(key, value),
				notify: (text) => assert.fail(text),
			},
		};
		const emit = async (name, event = {}) => {
			for (const handler of loaded.extensions[0].handlers.get(name)) await handler({ type: name, ...event }, ctx);
		};
		await emit("session_start");
		const user = { role: "user", content: "Summarize safely" };
		branch.push({ type: "message", message: user });
		await emit("message_end", { message: user });
		branch.push({ type: "message", message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Done" }] } });
		await emit("agent_settled", { aborted: false });
		await setImmediate();
		assert.ok(calls.length >= 1);
		assert.ok(calls.every(model => model.provider === "openai-codex" && model.id === "gpt-6-luna"));
		assert.equal(statuses.get("pi-recap"), "※ Recap: One two three");
		settings.setProjectTrusted(true);
		assert.equal(settings.getSettings().recap.model, "other-provider/private-model", "Fixture must contain a real project override");
		await emit("session_shutdown");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
