import bpmnEngineManager from "./bpmn-engine.js";
import * as fs from "fs";
import * as readline from "readline";
import * as path from "path";
import services from "./bpmn-flows/test-flow/test-flow.js";


const activityHandlers = {
    'UserTask': async (task) => {
        console.log(`Handling UserTask default: ${task.id}...`);
        console.log();
        await new Promise(r => setTimeout(() => r("Resultado " + task.id), 1000));
    },
    'userTaskId': (task) => {
        console.log(`Task was selected through ID: ${task.id}...`);
        console.log();
        setTimeout(() => {

        }, 3000);

    }
};

bpmnEngineManager.startEngine({
    flowName: 'test-flow',
    variables: {initialVariable: 'here'},
    instanceId: 'process-123',
    activityHandlers
}).then(c => {
    // console.log(c);
})