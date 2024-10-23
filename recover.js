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

let unfinishedProcess;

await bpmnEngineManager.getUnfinishedProcesses().then(c => {
    unfinishedProcess = c[0];
    console.log("UNFINISHED PROCESSES: ", c);
});

if (unfinishedProcess?.metadata?.timer) {
    bpmnEngineManager.resumeFlow({
        instanceId: unfinishedProcess.metadata.instanceId,
        flowName: unfinishedProcess.metadata.flowName,
    }).then(r => {
        console.log("RESUMED ENGINE: ", r);
    }).catch(err => {
        console.log("ERROR RESUMING ENGINE: ", err);
    });
} else
    bpmnEngineManager.resumeFlow({
    serializedStart : "eyJpbnN0YW5jZUlkIjoicHJvY2Vzcy0xMjMiLCJmbG93TmFtZSI6InRlc3QtZmxvdyIsInRhc2tJZFRvU2lnbmFsIjoidXNlclRhc2tJZCJ9",
    callback: (api) => {
        api.setMany({
            "test": "Variable successfully inserted before callback!",
            "test1": "test1",
        });
    }
}).then(c => {
    console.log("IT HAS FINISHED AFTER A RESUME OPERATION!", c);
}).catch(err => {
    console.log("ERROR HAS OCCURRED ON A RESUMED PROCESS!", err);
});
