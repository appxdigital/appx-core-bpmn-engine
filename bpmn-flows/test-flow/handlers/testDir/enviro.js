import {printer} from "../../../shared-functions/test-flow.js";

export async function testing (params)  {
    console.log("Testing the function");
}

export async function testing3 (params)  {
    printer.cyan("USER TASK!");
    printer.orange("USER TASK!");
    printer.yellow("USER TASK!");
}

export async function testing2(params) {
    try {
        printer.orange("________________________________ SUCCESSFUL TREE BUILT __________________________________")
    } catch (err) {
        throw err;
    }
}