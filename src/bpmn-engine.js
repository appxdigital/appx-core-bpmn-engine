import {Engine} from 'bpmn-engine';
import {EventEmitter} from 'events';
import {fileURLToPath, pathToFileURL} from "node:url";
import {createRequire} from "node:module";
import * as fs from "fs";
import * as path from "path";
import {dirname} from "path";

import {AsyncLocalStorage} from "node:async_hooks";
import {printer} from "./bpmn-flows/shared-functions/test-flow.js";
import activityHandlers from "./bpmn-flows/test-flow/activity-helpers/user.js";

const camunda = createRequire(fileURLToPath(import.meta.url))('camunda-bpmn-moddle/resources/camunda.json');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ContextStore = new AsyncLocalStorage();

const extensions = {
    relayingActivityOutputToEnvironment(activity) {
        activity.on('end', ({environment, content}) => {
            if (!!content.output && !Array.isArray(content.output)) {
                for (const [key, value] of Object.entries(content.output)) {
                    environment.output[key] = value;
                }
            }
        });
    },
    // camundaServiceTask(activity) {
    //     if (activity.behaviour.implementation) {
    //         console.log("HERE3")
    //         activity.behaviour.Service = ServiceExpression;
    //     }
    // },
};

// function ServiceExpression(activity) {
//     const {type: atype, behaviour, environment} = activity;
//     printer.orange("_____________________________________________________________________");
//     const implementation = behaviour.implementation;
//     printer.green(`IMPLEMENTATION: ${implementation}`);
//     printer.orange("_____________________________________________________________________");
//     const type = `${atype}:implementation`;
//     return {
//         type,
//         implementation,
//         execute,
//     };
//
//     function execute(executionMessage, callback) {
//         console.log("EXECUTION MESSAGE: ", executionMessage)
//         const serviceFn = environment.resolveExpression(implementation, executionMessage);
//         serviceFn.call(activity, executionMessage, (err, result) => {
//             callback(err, result);
//         });
//     }
// }

class BPMNEngineManager {
    constructor(
        config,
    ) {
        this.config_path = config.config_path;
        this.engines = new Map();
        this.listener = new EventEmitter();
        this.activityHandlers = {};
        this.saveToDatabase = this.#saveToDatabase;
        this.signaledTasks = new Set();
        this.pendingTasks = new Set();
        this.currentTimers = new Set();
        this.errorHandlers = new Set();
        this.errorThrown = false;
    }

    /**
     * Register handlers for different BPMN activity types.
     * @param {Object} handlers - An object where keys are activity types and values are handler functions.
     */
    registerActivityHandlers(handlers) {
        this.activityHandlers = {...this.activityHandlers, ...handlers};
    }

    /**
     * Save the current state of the engine to a file.
     * @param state - The state of the engine.
     * @param instanceId - Unique identifier for the process instance.
     * @param skipStop - Whether to skip stopping the engine before saving the state.
     * @param altPath
     */

    #saveToDatabase = (state, instanceId, skipStop = false, altPath = null) => {
        if (this.errorThrown) {
            console.error('An error has occurred, not saving state.');
            return;
        }
        console.log('Saving state to database...');

        if (!state) {
            console.error('No state found to save.');
            return;
        }

        const folderPath = altPath ?? 'src/saved';
        let fileName = `${instanceId}.json`;
        let filePath = path.join(folderPath, fileName);
        let fileIndex = 0;

        while (fs.existsSync(filePath)) {
            fileIndex++;
            fileName = `${instanceId}_${fileIndex}.json`;
            filePath = path.join(folderPath, fileName);
        }

        fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
        console.log(`State saved to ${altPath ?? 'src/saved/'}${fileName}`);

        if (!skipStop) {
            this.stopEngine(instanceId);
        }
    }

    /**
     * Delete all saved state files for a specific process instance.
     * @param instanceId - Unique identifier for the process instance.
     *
     * @param altPath
     */

    #deleteSavedState = (instanceId, altPath = null) => {
        console.log(`Deleting all saved state files for instanceId: ${instanceId}...`);

        const folderPath = 'src/saved';
        const filePattern = new RegExp(`^${instanceId}(_\\d+)?\\.json$`);

        const files = fs.readdirSync(folderPath);

        let count = 0;

        files.forEach((file) => {
            if (filePattern.test(file)) {
                const filePath = path.join(folderPath, file);
                fs.unlinkSync(filePath);
                count++;
                console.log(`Deleted: ${file}`);
            }
        });

        console.log(`All ${count} saved state files for instanceId: ${instanceId} have been deleted.`);
    };

    /**
     * Start a BPMN process instance for a specific order (or any unique identifier).
     * @param {Object} options - The options to start the engine.
     * @param {string} options.flowName - The folder name where the XML and services files are located.
     * @param {Object} options.variables - The initial variables for the process.
     * @param {string} options.instanceId - Unique identifier for the process instance (e.g., orderId).
     // * @param {Object} [options.activityHandlers] - Optional activity handlers for specific tasks.
     */
    async startEngine({flowName, variables = {}, instanceId}) {
        const start = async () => {

            this.errorThrown = false;

            if (!flowName) {
                throw new Error('Flow name is required to start the engine.');
            }

            const {bpmnXml: source, services: loadedServices} = await this.#loadBpmnAndServices(flowName);

            if (!source) {
                throw new Error('No BPMN XML file found in the directory.');
            }

            const wrappedServices = this.#wrapServices(loadedServices);

            const engine = new Engine({
                name: `bpmn-engine-${instanceId}`,
                moddleOptions: {
                    camunda,
                },
                source: this.#adjustSource(source),
                variables,
                services: wrappedServices,
                extensions,
            });

            this.attachListeners(engine, instanceId);

            this.engines.set(instanceId, engine);

            engine.execute({
                listener: this.listener,
            });

            return engine;
        }
        return new Promise((resolve, reject) => {
            ContextStore.run({flowName, variables, instanceId, resolve, reject}, async () => {
                //ContextStore.set('promiseResolver', { resolve, reject });

                try {
                    await start();
                } catch (e) {
                    printer.yellow("ERROR OCCURRED, REJECTING...")
                    reject(e);
                }
            });
        });
    }

    #completeEngine(instanceId, result) {
        const resolve = ContextStore.getStore().resolve;

        printer.green(`[${instanceId}] Engine promise about to be resolved with result: ${result}`)

        if (resolve && !this.errorThrown) {
            resolve(result);
        } else {
            console.error('No resolver found for instance:', instanceId);
        }
    }

    #failEngine(instanceId, error) {
        this.errorThrown = true;
        const reject = ContextStore.getStore().reject;

        if (reject) {
            this.stopEngine(instanceId);
            printer.red(`[${instanceId}] Engine promise about to be rejected due to error: ${error}`)
            console.log("ERROR: ", error)
            reject(error);
        } else {
            console.error('No reject function found for instance:', instanceId);
        }
    }


    /**
     * Wrap service tasks to inject executionContext and ensure callback is called.
     * @param {Object} services - Original service handlers.
     * @returns {Object} Wrapped service handlers.
     */
    #wrapServices(services) {
        const wrappedServices = {};

        for (const [serviceName, serviceFn] of Object.entries(services)) {
            wrappedServices[serviceName] = this.#wrapServiceFunction(serviceFn, serviceName);
        }

        return wrappedServices;
    }

    /**
     * Determine the type of activity (task or non-task).
     * @param task - The task object.
     * @returns {null|string} The type of activity or null if it doesn't match any of the bpmn expected types.
     */

    #getActivityType(task) {

        const taskTypes = [
            'bpmn:Task',
            'bpmn:UserTask',
            'bpmn:ServiceTask',
            'bpmn:ScriptTask',
            'bpmn:BusinessRuleTask',
            'bpmn:ManualTask',
            'bpmn:ReceiveTask',
            'bpmn:SendTask'
        ];

        if (taskTypes.includes(task.type)) {
            return 'task';
        }

        const nonTaskTypes = [
            'bpmn:ExclusiveGateway',
            'bpmn:ParallelGateway',
            'bpmn:Event',
            'bpmn:IntermediateCatchEvent',
            'bpmn:StartEvent',
            'bpmn:EndEvent',
            'bpmn:BoundaryEvent'
        ];

        if (nonTaskTypes.includes(task.type)) {
            return 'nonTask';
        }

        return null;
    }

    #wrapServiceFunction(serviceFn, serviceName) {
        let handle = function (executionContext, callback, args = []) {
            // console.log("EXECUTION CONTEXT: ", executionContext);
            // console.log("CALLBACK: ", typeof callback);
            // console.log("ARGS: ", arguments);
            if (typeof callback !== "function" || !executionContext?.content?.executionId)
                return (context, cbk) => handle(context, cbk, Object.values(arguments));


            function getServiceName () {
                return serviceName;
            }

            function returning (value) {
                set(`return-${serviceName}`, value);
            }

            function getReturn (serviceName) {
                return executionContext.environment.variables[`return-${serviceName}`];
            }

            function getReturns () {
                return Object.entries(executionContext.environment.variables).filter(([key]) => key.startsWith('return-'));
            }

            if (executionContext?.environment?.variables && !executionContext?.environment?.variables?.conditionResolver) {
                set("conditionResolver", (serviceName) => {
                    if (!serviceName) {
                        throw new Error("Service name is required for conditional logic.");
                    }

                    let condition;

                    try {
                        console.log("About to evaluate the service name or condition: ", serviceName);

                        const isCondition = /[<>!=]=|===|!==/.test(serviceName);

                        if (isCondition) {
                            //condition = eval(serviceName);
                            condition = Function("return " + serviceName)();
                            if (condition === false){
                                console.log("Condition is false, returning false.");
                                return false;
                            }
                        } else {
                            condition = undefined;
                        }

                    } catch (e) {
                        console.error("Error during evaluation: ", e);
                        condition = false;
                    }

                    if (condition === true) {
                        printer.orange(`Condition ${serviceName} evaluated as true, no need to call a service. Returning true.`);
                        return condition;
                    }

                    const accessor = serviceName?.replaceAll('.', '-');
                    const func = executionContext.environment.services[accessor];

                    if (!func) {
                        throw new Error(`Service ${serviceName} not found for conditional logic.`);
                    } else {
                        func(executionContext, callback, args);
                    }

                    const result = params.getReturn(accessor);

                    console.log("Result: ", typeof result);

                    return result || false;
                });
            }


            function set(key, value) {
                executionContext.environment.variables[key] = value;
            }

            function setMany(values) {
                for (const [key, value] of Object.entries(values)) {
                    executionContext.environment.variables[key] = value;
                }
            }

            function get(key) {
                return executionContext.environment.variables[key] || executionContext.environment.output[key] || null;
            }

            function getMany(keys) {
                if (!keys || keys.length === 0) {
                    return {...executionContext.environment.variables, ...executionContext.environment.output};
                }

                return keys.reduce((acc, key) => {
                    acc[key] = executionContext.environment?.variables[key] || executionContext.environment.output[key];
                    return acc;
                }, {});
            }

            const params = {
                context: executionContext,
                args,
                set,
                get,
                setMany,
                getMany,
                returning,
                getReturn,
                getReturns,
                getServiceName
            };

            (async () => {
                try {
                    await serviceFn(params);
                    callback();
                } catch (e) {
                    callback(e);
                }
            })();
        };

        return handle;
    }

    /**
     * Attach listeners to handle various BPMN events.
     * @param {Object} engine - The BPMN engine instance.
     * @param {string} instanceId - The unique identifier for the process instance.
     */
    attachListeners(engine, instanceId) {
        this.listener.removeAllListeners();

        let taskInProgress = false;

        this.listener.on('activity.wait', async (api, engineApi) => {
            if (api.type === 'bpmn:ErrorEventDefinition') {
                this.errorHandlers.add(api.content.attachedTo);
            } else if (api.content.isRecovered) {
                if (this.signaledTasks.has(api.id)) {
                    let handler = this.activityHandlers[api.id] || this.activityHandlers[api.name] || this.activityHandlers[api.type?.replace('bpmn:', '')];

                    const activity = engineApi.getActivityById(api.id);

                    const doAfter = activity?.behaviour?.extensionElements?.values?.find(value => !!value?.expression && value?.event === 'end');

                    if (doAfter) {
                        handler = this.activityHandlers[doAfter?.expression?.replace(".", "-")];
                    }

                    if (handler) {
                        console.log("Calling the aftermath function for ", api.id)

                        try {
                            await handler(this.#wrapApi(api, engineApi));
                        } catch (e) {
                            this.errorThrown = true;
                            printer.red(`[${instanceId}] Error in activity ${api.id}: ${e}`);
                            this.#failEngine(instanceId, `[${instanceId}] Error in activity ${api.id}: ${e}`);
                        }


                        // handler(this.#wrapApi(api, engineApi)).then(() => {
                        //
                        // }).catch( (e) => {
                        //     this.errorThrown = true;
                        //     printer.red(`[${instanceId}] Error in activity ${api.id}: ${e}`);
                        //     this.#failEngine(instanceId, `[${instanceId}] Error in activity ${api.id}: ${e}`);
                        // });
                    }
                }

                printer.orange("Skipping due to being recovered");
            } else {
                console.log(`[${instanceId}] Activity ${api.id} (${api.type}) is waiting for input.`);

                let handler = this.activityHandlers[api.id] || this.activityHandlers[api.name] || this.activityHandlers[api.type?.replace('bpmn:', '')];

                const activity = engineApi.getActivityById(api.id);

                const doBefore = activity?.behaviour?.extensionElements?.values?.find(value => !!value?.expression && value?.event === 'start');

                if (doBefore) {
                    handler = this.activityHandlers[doBefore?.expression?.replace(".", "-")];
                }

                if (handler) {
                    console.log("Calling the function for ", api.id)
                    await handler(this.#wrapApi(api, engineApi));
                    //BPMNEngineContext.setOutput(api.id, result);
                } else {
                    console.log(`[${instanceId}] No handler registered for activity with ID: ${api.id} and name: ${api.name}`);
                    // if (api.type === 'bpmn:UserTask') {
                    //     api.signal();
                    // }
                }

                if (api.type === "bpmn:ErrorEventDefinition") {
                    //api.signal();
                    // return;
                }

                // if (!taskInProgress) {
                //     taskInProgress = true;
                //
                //     if (this.saveToDatabase) {
                //         // api.broker.subscribeTmp('event', 'activity.signal', async (api) => {
                //         //     console.log(`[${instanceId}] Signaling the activity ${api.id}...`);
                //         // });
                //         console.log("Saving...");
                //         await this.saveToDatabase(await this.saveEngineState(instanceId, api.id), instanceId);
                //     } else {
                //         console.log("Not saving...");
                //     }
                //
                //     taskInProgress = false;
                // }
                console.log("Saving on activity wait...");
                await this.saveToDatabase(await this.saveEngineState(instanceId, api.id), instanceId);
            }
        });

        this.listener.on('activity.error', (api, error) => {
            if(this.errorHandlers.has(api.id)) {
                this.errorHandlers.delete(api.id);
                return;
            }
            this.errorThrown = true;
            console.log("ERROR: ", api.content?.error)
            this.#failEngine(instanceId, `[${instanceId}] Error in activity ${api.id}: ${api.content?.error}`)
        });

        this.listener.on('activity.signal', (api) => {
            printer.green("Signaling the activity...")
            printer.orange("Signaling the activity...")
            printer.red("Signaling the activity...")
        });

        this.listener.on('activity.start', (api) => {
            if (this.errorThrown) {
                console.error(`An error has occurred, will not be continuing with activity start ${api.id}.`);
                return;
            }

            printer.green(`[${instanceId}] Activity ${api.id} started. (Type: ${api.type})`);
        });

        this.listener.on('activity.timer',  (api) => {
            printer.green(`[${instanceId}] Activity ${api.id} has a timer event.`);

            // this.saveEngineState(instanceId, "Timer started").then((state) => {TODO revisit this to have some sort of way to let timers be saved and restarted if needed. Asynchronous operations make this difficult because the timer is ignored.
            //     this.saveToDatabase(state, instanceId, false, "src/on-timer/")
            //     this.currentTimers.add(api.id);
            //     console.log("Timer state saved...");
            // }).catch((e) => {
            //     console.error("Error saving timer state: ", e);
            // });
        });



        this.listener.on('activity.end', async (api, engine) => {
            printer.red(`[${instanceId}] Activity ${api.id} has ended.`);

            if (api.type === 'bpmn:EndEvent'){
                //TODO continue here, check if it's necessary to add a way to determine which end event is the 'correct' one, know if it should trigger the promise resolution, if it should delete all states, if it should save, if it should find a way to resume back to before the error (maybe this is on the modeler...). idk dude, think of something
            }

            if (api.type === 'bpmn:EndEvent' && api.id === 'final') {
                console.log(`[${instanceId}] Process for instance ${instanceId} has completed.`);
                setTimeout(() => {
                    this.#deleteSavedState(instanceId);
                }, 5000);
                //this.#deleteSavedState(instanceId);
            }

            if (this.errorHandlers.has(api.id)) {
                this.errorHandlers.delete(api.id);
            }

            if (this.currentTimers.has(api.id)) {
                // console.log("Timer has ended...")
                // this.currentTimers.delete(api.id);
                // this.#deleteSavedState(instanceId, "src/on-timer");
            }

            if (this.signaledTasks.has(api.id)) {
                this.signaledTasks.delete(api.id);
                if (!this.errorThrown) {
                    this.#completeEngine(instanceId, 'Promise being resolved, task signaled.');
                } else {
                    return;
                }
                if (this.pendingTasks.size > 0) {
                    console.log("Saving... Pending tasks: ", this.pendingTasks)
                    await this.saveToDatabase(await this.saveEngineState(instanceId, "Other pending tasks"), instanceId, true);
                } else {
                    console.log("No pending tasks found.");
                }
            } else if (this.#getActivityType(api) === 'task') {
                printer.yellow("Saving on successful activity end...")
                await this.saveToDatabase(await this.saveEngineState(instanceId, api.id), instanceId, true);
            }

            if (api.content.output) {
                if (!(Array.isArray(api.content.output) && api.content.output.length <= 0)) {
                    engine.environment.output = {...api.content.output};
                }
            }
        });

        this.listener.on('flow.take', (flow) => {
            console.log("FLOW: ", flow.owner.behaviour)
            console.log(`[${instanceId}] Flow taken from ${flow.content.sourceId} to ${flow.content.targetId}`);
        });

    }

    /**
     * Save the current state of the engine for a specific process instance.
     * @param {string} instanceId - The unique identifier for the process instance.
     * @param causedBy - The reason for saving the state.
     */
    async saveEngineState(instanceId, causedBy = "") {
        if (this.errorThrown) {
            return;
        }
        const engine = this.engines.get(instanceId);
        if (!engine) {
            console.error(`No engine found for instance ${instanceId}`);
            return;
        }

        const state = await engine.getState();
        console.log(`[${instanceId}] Engine state returned to be saved. (Caused by: ${causedBy || 'N/A'})`);
        return state;
    }

    /**
     * Resume a previously saved BPMN process instance.
     * @param {Object} options - Options to resume the engine.
     * @param {string} options.instanceId - Unique identifier for the process instance.
     * @param {function} [options.callback] - Optional callback for custom handling of user tasks.
     * @param {string || null} [options.taskIdToSignal] - Optional task ID to signal after resuming the engine. TODO May need to make this mandatory.
     */

    async resumeEngine({instanceId, flowName, callback = null, taskIdToSignal = null}) {

        const resume = async () => {

            this.errorThrown = false;

            if (!flowName) {
                throw new Error('Flow name is required to start the engine.');
            }

            console.log(`[${instanceId}] Resuming the engine...`);

            console.log("About to restart engine...");

            const {bpmnXml: source, services: loadedServices} = await this.#loadBpmnAndServices(flowName);

            const loadedState = this.loadEngineState(instanceId);

            const engine = Engine().recover(loadedState, {
                moddleOptions: {
                    camunda,
                },
                extensions,
                services: this.#wrapServices(loadedServices),
            });

            const listener = this.listener || new EventEmitter();

            this.attachListeners(engine, instanceId);

            listener.once('wait', async (api, engine) => {
                console.log(`[${instanceId}] Engine is waiting on a task...`);

                if (callback) {
                    callback(this.#wrapApi(api, engine), engine);
                }
            });

            console.log("Reaching critical point...");

            this.engines.set(instanceId, engine);

            if (taskIdToSignal) {
                this.signaledTasks.add(taskIdToSignal);
            }

            const execution = await engine.resume({listener}, (err) => {
                if (err) {
                    console.error(`[${instanceId}] Error resuming the process:`, err);
                    if (this.engines.has(instanceId)) {
                        this.engines.delete(instanceId);
                    }
                } else {
                    console.log(`[${instanceId}] 1. Process resumed for instance ${instanceId}.`);
                    //this.engines.set(instanceId, engine);
                }
            });

            if (taskIdToSignal) {
                let matchedTask = null;

                execution.getPostponed().forEach(task => {
                    if (task.type.includes("SubProcess")) {
                        const subTask = task.getPostponed().find(subTask => subTask.id === taskIdToSignal);

                        task.getPostponed().forEach(subTask => {
                            if (subTask.id !== taskIdToSignal && !subTask.type.includes("SubProcess")) {
                                this.pendingTasks.add(subTask.id);
                            }
                        });

                        if (subTask) {
                            matchedTask = subTask;
                        }
                    } else {
                        if (task.id !== taskIdToSignal && !task.type.includes("SubProcess") && this.#getActivityType(task) === 'task') {
                            this.pendingTasks.add(task.id);
                        }

                        if (task.id === taskIdToSignal) {
                            matchedTask = task;
                        }
                    }
                });

                if (matchedTask) {
                    printer.orange(`[${instanceId}] Signaling task with id ${taskIdToSignal}`);

                    matchedTask.signal(Object.keys(execution.environment.output)?.length > 0 ? execution.environment?.output : null, {id: taskIdToSignal});

                    this.pendingTasks.delete(taskIdToSignal);
                } else {
                    this.signaledTasks.delete(taskIdToSignal);
                }
            }
        }

        return new Promise((resolve, reject) => {
            ContextStore.run({flowName, instanceId, resolve, reject}, async () => {

                try {
                    await resume();
                } catch (e) {
                    printer.yellow("ERROR OCCURRED, REJECTING...")
                    reject(e);
                }
            });
        });
    }

    #wrapApi = (api, engine) => {
        function emitSignal(id, data = null) {
            if (api.id === id) {
                console.log(`Signaling task with id ${api.id}`);
                if (typeof api.signal === 'function') {
                    api.signal(data, {
                        id: id,
                    });
                } else {
                    console.warn('api.signal is not a function');
                }
            }
        }

        function setMany(values) {
            for (const [key, value] of Object.entries(values)) {
                engine.environment.output[key] = value;
            }
        }

        function set(key, value) {
            engine.environment.output[key] = value || null;
        }

        function get(key) {
            return engine?.environment?.variables[key] || engine?.environment?.output[key] || null;
        }

        function getMany(keys) {
            if (!keys || keys.length === 0) {
                return {...engine.environment.variables, ...engine.environment.output, ...api.environment.variables, ...api.environment.output};
            }

            return keys.reduce((acc, key) => {
                acc[key] = api.environment?.variables[key] || engine.environment.output[key] || api.environment.variables[key] || null;
                return acc;
            }, {});
        }

        const wrappedApi = Object.create(Object.getPrototypeOf(api), Object.getOwnPropertyDescriptors(api));

        wrappedApi.emitSignal = emitSignal;
        wrappedApi.set = set;
        wrappedApi.setMany = setMany;
        wrappedApi.get = get;
        wrappedApi.getMany = getMany;

        return wrappedApi;
    }

    /**
     * Load the state of the engine for a specific process instance.
     * @param instanceId - Unique identifier for the process instance.
     * @param version - The version of the state to load. If not provided, the latest state will be loaded. If it's zero, the initial state will be loaded. If it's a negative number, the state will be loaded based on the order of versions, from the latest to the oldest.
     * @returns {any} The state of the engine.
     */


    loadEngineState(instanceId, version = null) {
        const folderPath = 'src/saved';

        const files = fs.readdirSync(folderPath).filter(file => file.startsWith(instanceId) && file.endsWith('.json'));

        if (files.length === 0) {
            console.log("No state files found for instance ID: ", instanceId);
            return;
        }

        let fileName;

        if (version === null) {
            const latestFile = files
                .map(file => {
                    const match = file.match(new RegExp(`${instanceId}_(\\d+)\\.json`));
                    return match ? {file, version: parseInt(match[1], 10)} : {file, version: 0};
                })
                .sort((a, b) => b.version - a.version)[0];

            fileName = latestFile.file;
        } else {
            if (typeof version !== 'number') {
                throw new Error('Version must be a number.');
            }

            if (version > 0) {
                fileName = `${instanceId}_${version}.json`;
                if (!files.includes(fileName)) {
                    throw new Error(`State file with version ${version} not found for instance ID: ${instanceId}`);
                }
            } else if (version === 0) {
                fileName = `${instanceId}.json`;
            } else {
                const sortedFiles = files
                    .map(file => {
                        const match = file.match(new RegExp(`${instanceId}_(\\d+)\\.json`));
                        return match ? {file, version: parseInt(match[1], 10)} : {file, version: 0};
                    })
                    .sort((a, b) => b.version - a.version);

                const index = Math.abs(version) - 1;

                if (index >= sortedFiles.length) {
                    throw new Error(`State file with version ${version} not found for instance ID: ${instanceId}`);
                }

                //TODO test this feature with a negative number
                fileName = sortedFiles[index].file;
            }
        }

        const filePath = path.join(folderPath, fileName);
        const state = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

        console.log(`Loaded state from ${fileName}`);
        return state;
    }

    /**
     * Stop the engine for a specific instance.
     * @param {string} instanceId - Unique identifier for the process instance.
     */
    stopEngine(instanceId) {
        const engine = this.engines.get(instanceId);
        if (engine) {
            engine.stop();
            console.log(`Engine stopped for instance ${instanceId}`);
            this.engines.delete(instanceId);
            if (!this.errorThrown) {
                this.#completeEngine(instanceId, 'Promise being resolved, engine stopped.');
            }
        } else {
            console.log(`No engine found for instance ${instanceId}`);
        }
    }

    /**
     * Adjust the source code to replace the camunda:expression with implementation
     * and convert the conditionExpression to JavaScript language, at the moment not optional and private
     * @param {string} source - The BPMN XML source.
     * @returns {string} The updated XML source.
     * */

    #adjustSource = (source) => {
        const conditionRegex = /<bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">(.*?)<\/bpmn:conditionExpression>/g;

        const expressions = this.#findCamundaExpressions(source);
        source = expressions.reduce((updatedSource, expression) => {
            const regex = new RegExp(`camunda:expression="${expression}"`, 'g');
            return updatedSource.replace(regex, `camunda:expression="\${environment.services.${expression.replaceAll('.', '-')}}"`);
        }, source);

        return source
            ?.replaceAll('camunda:expression', 'implementation')
            ?.replaceAll(conditionRegex, (match, condition) => {
                if (!condition) {
                    return match;
                }

                const transformedCondition = `\${environment.variables.conditionResolver('${condition}')}`;
                printer.yellow(`Transformed condition: ${transformedCondition}`);

                return `<bpmn:conditionExpression xsi:type="bpmn:tFormalExpression"
                                             >${transformedCondition}</bpmn:conditionExpression>`;
            });
    };


    #findCamundaExpressions = (source) => {
        const regex = /<[^>]*camunda:expression="([^"]*)"[^>]*>/g;
        const matches = [];
        let match;

        while ((match = regex.exec(source)) !== null) {
            matches.push(match[1]);
        }

        return matches;
    };

    /**
     * Load the BPMN XML and services file for a specific flow.
     * @param flowName - The name of the flow (directory name).
     * @returns {Promise<{services: *, bpmnXml: null}>}
     */

    async #loadBpmnAndServices(flowName) {
        try {
            //const baseDirectory = path.join(__dirname, 'bpmn-flows');

            const directoryPath = path.join(this.config_path, flowName);

            if (!fs.existsSync(directoryPath)) {
                throw new Error(`Directory not found: ${directoryPath}`);
            }

            const files = await fs.promises.readdir(directoryPath);

            const bpmnFiles = files.filter(file => path.extname(file) === '.bpmn');

            if (bpmnFiles.length > 1) {
                throw new Error(`Multiple BPMN files found in directory, only one source (.bpmn file) per flow: ${directoryPath}`);
            }

            const bpmnFile = bpmnFiles[0];

            let bpmnXml = null;

            if (bpmnFile) {
                const bpmnFilePath = path.join(directoryPath, bpmnFile);
                bpmnXml = await fs.promises.readFile(bpmnFilePath, 'utf-8');
            }

            const sharedServices = await this.loadHandlers();

            const serviceTree = await this.loadHandlers(path.join(this.config_path, flowName, 'handlers'));

            const activityHandlers = await this.loadHandlers(path.join(this.config_path, flowName, 'activity-helpers'));

            const flattenedActivityHandlers = {};

            let flattenedServices = {};

            function flatten(obj, aggregator, path = '') {
                for (const key in obj) {
                    if (Object.prototype.hasOwnProperty.call(obj, key)) {
                        if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
                            flatten(obj[key], aggregator, path ? `${path}-${key}` : key);
                        } else {
                            aggregator[path ? `${path}-${key}` : key] = obj[key];
                        }
                    }
                }
            }

            flatten(activityHandlers, flattenedActivityHandlers);

            this.registerActivityHandlers(flattenedActivityHandlers);

            flatten({...sharedServices, ...serviceTree}, flattenedServices);

            return {
                bpmnXml,
                services: {...flattenedServices}
            };
        } catch (error) {
            console.error('Error loading BPMN or services file:', error);
            throw error;
        }
    }

    async loadHandlers(directPath = null) {
        const dirPath = directPath || path.join(this.config_path, 'shared-functions');
        const services = {};

        async function traverseDirectory(currentPath, obj, parentKey = '') {
            const files = fs.readdirSync(currentPath);

            for (const file of files) {
                const fullPath = path.join(currentPath, file);
                const stat = fs.statSync(fullPath);

                if (stat.isDirectory()) {
                    await traverseDirectory(fullPath, obj, parentKey + file + '-');
                } else if (file.endsWith('.js')) {
                    const module = await import(pathToFileURL(fullPath).href);
                    const fileNameWithoutExt = path.basename(file, '.js');

                    obj[parentKey + fileNameWithoutExt] = module.default || module;
                }
            }
        }

        await traverseDirectory(dirPath, services);

        return services;
    }


}

// const bpmnEngineManager = new BPMNEngineManager();
// export default bpmnEngineManager;

export {BPMNEngineManager};

const BPMNEngineContext = {
    get variables() {
        return ContextStore.getStore().variables
    },
    get previousOutput() {

    }
}

export {BPMNEngineContext};
