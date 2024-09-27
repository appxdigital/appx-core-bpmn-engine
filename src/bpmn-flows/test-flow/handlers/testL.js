import {printer} from "../../shared-functions/test-flow.js";

const services = {
    testing : async (params) => {
        console.log("Testing the function");
    },

    testing2 : async (params) => {
        console.log("Testing the function 2");
    },

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
        throw new Error('Error thrown from the promptUser function!');
        //rl.close();
    },

    get: async (params) => {
        console.log('Logging function is being called, it will now await for async function to complete in 5 seconds...');
        //I want it now to await here and only then proceed with the following console.log

        const test = await new Promise((resolve, reject) => {
            setTimeout(() => {
                resolve('Success');
            }, 5000);
        });

        console.log("The function has been called and the result is: " + test);

        // console.log("Variables", BPMNEngineContext.variables);
        console.log("Arguments", params.args);
        //
        // console.log("params.context.constructor.name");
        // console.log(params.context.constructor.name);

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
        printer.red("Error was thrown via the error throwing event!")
    },

    task3: async (params) => {
        console.log("Sending order to the warehouse...");
    },

    task5: async (params) => {
        console.log("Sending order to the warehouse...");

    },

    reminder: async (params) => {
        console.log("params", params.getMany());
        // params.set('lot', (test) => {
        //     console.log("IT MADE IT HERE!")
        //     console.log(params.context.environment.services);
        //     console.log("test", test)
        //     return test === 'success';
        // })
    },

    reminder1: async (params) => {
        printer.orange("Post user task event has been triggered!")
    },

    logger: async (params) => {
        printer.orange("PROBLEM HAS OCCURRED!")
    },

    logger1: async (params) => {
        printer.green("THINGS ARE FINE")
    }
}

export default services;