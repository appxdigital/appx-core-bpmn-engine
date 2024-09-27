
import * as fs from "fs";
import * as readline from "readline";
import * as path from "path";
import {BPMNEngineManager} from "./bpmn-engine.js";
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const bpmnEngineManager = new BPMNEngineManager({
    config_path: path.join(__dirname, 'bpmn-flows'),
});

bpmnEngineManager.startEngine({
    flowName: 'test-flow',
    variables: {userNames: 'John Doe'},
    instanceId: 'process-123',
}).then(c => {
    console.log("IT HAS FINISHED!", c)
}).catch(err => {
    console.log("ERROR HAS OCCURRED!")
})


// import BpmnEngine from "./bpmn-engine.js";
// import path from "path";
//
// const engine = new BpmnEngine({
//     config_path: path.join(__dirname, 'bpmn-flows'),
//
// });
//



