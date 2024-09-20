import readline from "readline";
import {printer} from "../../functions.js";
import {BPMNEngineContext} from "../../bpmn-engine.js";

const services = {
    promptUser: async (params) => {
        const test = params.get('userName');
        // const rl = readline.createInterface({
        //     input: process.stdin,
        //     output: process.stdout,
        // });

        // const question = (query) => new Promise(resolve => rl.question(query, resolve));
        //
        // const reply = await question(`${test}, what's the status of testing?`);
        //
        // if (reply === 'error') {
        //     params.callback(new Error(''));
        // }
        //
        // params.executionContext.environment.variables.userName = reply;

        console.log("The first function set 'test' as : " + test)
        //rl.close()
    },

    get: (params) => {
        console.log('Logging function is being called, performing x function...');
        console.log("Variables", BPMNEngineContext.variables);
        console.log("Arguments", params.args);
        params.set('userName', 'John Doe')
    },

    test: async (params) => {
        const userName = params.get('userName') || "Unknown";
        console.log(`Printing the status: ${userName}`);
    },

    test1: async (params) => {
        const userName = params.get('userName') || "Unknown";
        console.log("Status was not success, it was: ", userName)
    },

    test2: async (params) => {
        printer.red("Error was thrown!")
    },

    task3: async (params) => {
        console.log("Sending order to the warehouse...");
    },

    task5: async (params) => {
        console.log("Sending order to the warehouse...");

    },

    reminder: async (params) => {
        console.log(params.context.environment.variables)
    },

    reminder1: async (params) => {
        printer.orange("Post user task event has been triggered!")
    },

    logger: async (params) => {
    }
};

export default services;