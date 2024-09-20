import bpmnEngineManager from "./bpmn-engine.js";
import * as fs from "fs";
import services from "./bpmn-flows/test-flow/test-flow.js";

console.log("Recovering the engine...");

//read from src/saved/state.json

await bpmnEngineManager.resumeEngine({
    instanceId: "process-123",
    flowName: "test-flow",
    services: services,
    taskIdToSignal: "userTask",
    callback: (api) => {

        console.log("Second call: ")
        console.log(api.get("test"));

    }
});