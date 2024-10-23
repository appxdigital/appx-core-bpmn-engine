import {printer} from "../../shared-functions/test-flow.js";

const activityHandlers = {
    userTask: async (task) => {
        console.log(`Handling UserTask default: ${task.id}...`);
        console.log();
        //await new Promise(r => setTimeout(() => r("Resultado " + task.id), 1000));
    },
    userTaskId: async (task) => {
        console.log(`Task was selected through ID: ${task.id}...`);
        //await new Promise(r => setTimeout(() => r("Resultado " + task.id), 10000));
        const test = task.getSerialized();
        console.log("SERIALIZED :", test);
        const unbase64 = Buffer.from(test, 'base64').toString('utf-8');
        console.log("UNBASE64 :", unbase64);
        const parsed = JSON.parse(unbase64);
        console.log("PARSED :", parsed);
        printer.cyan("SUCCEEEEEEEEESSSSSSSSSSSSS")
    },
    userTaskIdPost: async (task) => {
        console.log(`Task was selected through ID: ${task.id}...`);
        printer.cyan("Confirmed aftermath of task restoration!");
        // throw new Error("user.userTaskIdPost is throwing a test error!");
    }
};

export default activityHandlers;