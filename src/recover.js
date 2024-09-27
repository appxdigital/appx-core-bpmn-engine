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

const activityHandlers = {
    'userTask': (task) => {
        console.log(`Handling UserTask default: ${task.id}...`);
        console.log();
        setTimeout(() => {

        }, 3000);
    },
    'userTaskId': (task) => {
        console.log(`Task was selected through ID: ${task.id}...`);
        console.log();
        setTimeout(() => {

        }, 3000);

    }
};


bpmnEngineManager.resumeEngine({
    instanceId: "process-123",
    flowName: "test-flow",
    taskIdToSignal: "userTaskId",

    callback: (api) => {

        api.setMany({
            "test": "Variable successfully inserted before callback!",
            "test1": "test1",
        });
    }
}).then(c => {
    console.log("IT HAS FINISHED AFTER A RESUME OPERATION!", c)
}).catch(err => {
    console.log("ERROR HAS OCCURRED ON A RESUMED PROCESS!", err)
})
