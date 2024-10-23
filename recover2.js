import * as path from "path";
import * as fs from "fs";
import { BPMNEngineManager } from "./src/bpmn-engine.js";
import { fileURLToPath } from 'url';
import session from 'express-session';
import FileStore from 'session-file-store';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SessionFileStore = FileStore(session);
const sessionsDir = path.join(__dirname, 'sessions');
const storage = new SessionFileStore({ path: sessionsDir, logFn: function() {} });

const bpmnEngineManager = new BPMNEngineManager({
    config_path: path.join(__dirname, 'bpmn-flows'),
    storage: storage,
});

console.log("Recovering the engine...");

bpmnEngineManager.resumeFlow({
    instanceId: "process-123",
    flowName: "test-flow",
    taskIdToSignal: "userTask",

    callback: (api) => {

        console.log("Second call: ")
        console.log(api.get("test"));
    }
}).then(c => {
    console.log("IT HAS FINISHED AFTER A 2ND RESUME OPERATION!", c)
}).catch(err => {
    console.log("ERROR HAS OCCURRED ON A 2ND RESUMED PROCESS!", err)
})
