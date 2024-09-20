import bpmnEngineManager from "./bpmn-engine.js";
import * as fs from "fs";
import services from "./bpmn-flows/test-flow/test-flow.js";
import bpmnEngine from "./bpmn-engine.js";

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

await bpmnEngineManager.resumeEngine({
    instanceId: "process-123",
    flowName: "test-flow",
    services: services,
    activityHandlers,
    taskIdToSignal: "userTaskId",
    callback: (api) => {

        api.setMany({
            "test": "Variable successfully inserted before callback!",
            "test1": "test1",
        });
    }
});
