import * as path from "path";
import * as fs from "fs";
import {BPMNEngineManager} from "./bpmn-engine.js";
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const bpmnEngineManager = new BPMNEngineManager({
    config_path: path.join(__dirname, 'bpmn-flows'),
});

console.log("Recovering the engine...");

//read from src/saved/state.json

bpmnEngineManager.resumeEngine({
    instanceId: "process-123",
    flowName: "test-flow",
    taskIdToSignal: "userTaskId",

    callback: (api) => {

        console.log("Second call: ")
        console.log(api.get("test"));
    }
}).then(c => {
    console.log("IT HAS FINISHED AFTER A 2ND RESUME OPERATION!", c)
}).catch(err => {
    console.log("ERROR HAS OCCURRED ON A 2ND RESUMED PROCESS!", err)
})
