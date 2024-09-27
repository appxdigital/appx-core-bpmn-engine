import readline from "readline";
import {BPMNEngineContext} from "../../bpmn-engine.js";

const services = {
    sharedLog() {
        printer.cyan("Shared log function called!");
    },

    sharedTest(params) {
        const random = (Math.random() + 1) * 100 < 50;
        printer.cyan(`Shared test called! Returning ${random}`);
        params.returning(random);
    }
}

class printer {
    static red(text) {
        console.log('\x1b[31m%s\x1b[0m', text);
    }

    static orange(text) {
        console.log('\x1b[33m%s\x1b[0m', text);
    }

    static green(text) {
        console.log('\x1b[32m%s\x1b[0m', text);
    }

    static blue(text) {
        console.log('\x1b[34m%s\x1b[0m', text);
    }

    static cyan(text) {
        console.log('\x1b[36m%s\x1b[0m', text);
    }

    static yellow (text) {
        console.log('\x1b[33m%s\x1b[0m', text);
    }
}

export {printer};

export default services;