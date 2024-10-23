import {Engine} from 'bpmn-engine';
import {EventEmitter} from 'events';
import {fileURLToPath, pathToFileURL} from "node:url";
import {createRequire} from "node:module";
import * as fs from "fs";
import * as path from "path";
import {AsyncLocalStorage} from "node:async_hooks";
import {printer} from "../bpmn-flows/shared-functions/test-flow.js";
import {StoreManager} from "./storage/store-filestore.js";
import {SaveQueue} from "./storage/queue.js";
import {Builder, parseStringPromise} from "xml2js";

const camunda = createRequire(fileURLToPath(import.meta.url))('camunda-bpmn-moddle/resources/camunda.json');

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
};

class BPMNEngineManager {
    constructor(
        config,
    ) {
        if (!config.storage) {
            throw new Error('Storage is required to save the state of the engine');
        }
        this.config_path = config.config_path;
        this.storage = new StoreManager(config.storage);
        this.maintainState = config.maintainState || false;
        // this.engines = new Map();
        this.listener = new EventEmitter();
        this.saveToDatabase = this.#saveToDatabase;
        this.activityHandlers = {};
        //this.signaledTasks = new Set();
        // this.pendingTasks = new Set();
        //this.errorHandlers = new Set();
        // this.errorThrown = false;
        this.saveQueue = new SaveQueue();

        this.engineStateMap = new Map();


        this.getUnfinishedProcesses().then((processes) => {
            if (processes.length === 0) {
                console.log("No unfinished processes found.");
            } else {
                for (const process of processes) {
                    if (process?.metadata) {
                        this.resumeFlow(null,{
                            instanceId: process.metadata.instanceId,
                            flowName: process.metadata.flowName,
                        }).then(r => {
                            console.log("RESUMED ENGINE: ", r);
                        }).catch(err => {
                            console.log("ERROR RESUMING ENGINE: ", err);
                        });
                    }
                }
            }
        });
    }

    /**
     * Register handlers for different BPMN activity types.
     * @param {Object} handlers - An object where keys are activity types and values are handler functions.
     */
    registerActivityHandlers(handlers) {
        this.activityHandlers = {...this.activityHandlers, ...handlers};
    }


    #initializeEngineState(engineId, engine) {
        this.engineStateMap.set(engineId, {
            engine,
            errorThrown: false,
            signaledTasks: new Set(),
            pendingTasks: new Set(),
            errorHandlers: new Set(),
        });
    }

    /**
     * Save the current state of the engine to a file.
     * @param state - The state of the engine.
     * @param instanceId - Unique identifier for the process instance.
     * @param {string | null} [skipStop] - Whether to stop the engine after saving the state.
     * @param {Object} [metadata] - Additional metadata to save with the state.
     */

    #saveToDatabase = async (state, instanceId, {skipStop = null, metadata = {}} = {}) => {
        if (this.#errorThrown(instanceId)) {
            console.error('An error has occurred, not saving state.');
            return;
        }
        console.log('Saving state to database...');

        metadata = {...metadata, instanceId, flowName: state?.environment?.variables?.flowName};

        await this.storage.save(instanceId, state, metadata).then(() => {
            console.log(`Engine has confirmed that instance ${instanceId} was saved.`);
        });

        if (!skipStop) {
            this.stopEngine(instanceId);
        } else if (skipStop === 'timer'){
            this.#completeEngine(instanceId, 'Promise being resolved, timer is active.');
        }
    }

    /**
     * Delete all saved state files for a specific process instance.
     * @param instanceId - Unique identifier for the process instance.
     */

    #deleteSavedState = async (instanceId) => {
        console.log(`Deleting all saved state files for instanceId: ${instanceId}...`);
        await this.storage.deleteAllVersions(instanceId).then((count) => {
            console.log(`All ${count} saved state files for instanceId: ${instanceId} have been deleted.`);
            this.stopEngine(instanceId);
        });
    };

    /**
     * Start a BPMN process instance for a specific order (or any unique identifier).
     * @param {Object} options - The options to start the engine.
     * @param {string} flowName - The folder name where the XML and services files are located.
     * @param {Object} options.variables - The initial variables for the process.
     * @param {string} options.instanceId - Unique identifier for the process instance (e.g., orderId).
     // * @param {Object} [options.activityHandlers] - Optional activity handlers for specific tasks.
     */
    async startFlow(flowName, {variables = {}, instanceId}) {
        const start = async () => {

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
                source: await this.#adjustSource(source),
                variables: {...variables, flowName: flowName},
                services: wrappedServices,
                extensions,
            });

            this.attachListeners(engine, instanceId);

            this.#initializeEngineState(instanceId, engine);

            this.#setErrorThrown(instanceId, false);

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

        if (resolve && !this.#errorThrown(instanceId)) {
            resolve(result);
        } else {
            console.error('No resolver found for instance:', instanceId);
        }
    }

    #failEngine(instanceId, error) {
        this.#setErrorThrown(instanceId, true);
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
            if (typeof callback !== "function" || !executionContext?.content?.executionId)
                return (context, cbk) => handle(context, cbk, Object.values(arguments));


            function getServiceName() {
                return serviceName;
            }

            function returning(value) {
                set(`return-${serviceName}`, value);
            }

            function getReturn(serviceName) {
                return executionContext.environment.variables[`return-${serviceName}`];
            }

            function getReturns() {
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
                            if (condition === false) {
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
                    const func = executionContext.environment?.services[accessor];

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
                this.#errorHandlers(instanceId).add(api.content.attachedTo);
            } else if (api.content.isRecovered) {
                if (this.#signaledTasks(instanceId).has(api.id)) {
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
                            this.#setErrorThrown(instanceId, true);
                            printer.red(`[${instanceId}] Error in activity ${api.id}: ${e}`);
                            this.#failEngine(instanceId, `[${instanceId}] Error in activity ${api.id}: ${e}`);
                        }
                    }
                }

                printer.orange("Skipping due to being recovered");
            } else {
                console.log(`[${instanceId}] Activity ${api.id} (${api.type}) is waiting for input.`);

                let handler = this.activityHandlers[api.id] || this.activityHandlers[api.name] || this.activityHandlers[api.type?.replace('bpmn:', '')];

                const activity = engineApi.getActivityById(api.id);

                const doBefore = activity?.behaviour?.extensionElements?.values?.find(value => !!value?.expression && value?.event === 'start') || api.owner?.behaviour?.extensionElements?.values?.find(value => !!value?.expression && value?.event === 'start');

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

                function isTimerActive(timer) {
                    if (!timer?.startedAt || !timer?.expireAt) {
                        console.warn("Invalid timer data");
                        return false;
                    }

                    const currentTime = new Date();
                    const startedAt = new Date(timer.startedAt);
                    const expireAt = new Date(timer.expireAt);

                    return currentTime >= startedAt && currentTime <= expireAt;
                }

                const timer = !!api?.environment?.timers?.executing?.find((t) => isTimerActive(t?.owner));

                console.log("Saving on activity wait...");
                await this.saveQueue.enqueue(instanceId, async () => {
                    await this.saveToDatabase(await this.saveEngineState(instanceId, api.id), instanceId, {skipStop: timer ? "timer" : null});
                });
            }
        });

        this.listener.on('activity.error', (api, error) => {
            if (this.#errorHandlers(instanceId).has(api.id)) {
                this.#errorHandlers(instanceId).delete(api.id);
                return;
            }
            this.#setErrorThrown(instanceId, true);
            console.log("ERROR: ", api.content?.error)
            this.#failEngine(instanceId, `[${instanceId}] Error in activity ${api.id}: ${api.content?.error}`)
        });

        this.listener.on('activity.signal', (api) => {
            printer.green("Signaling the activity...")
            printer.orange("Signaling the activity...")
            printer.red("Signaling the activity...")
        });

        this.listener.on('activity.start', (api) => {
            if (this.#errorThrown(instanceId)) {
                console.error(`An error has occurred, will not be continuing with activity start ${api.id}.`);
                return;
            }

            printer.green(`[${instanceId}] Activity ${api.id} started. (Type: ${api.type})`);
        });

        this.listener.on('activity.timer', async (api) => {
            printer.green(`[${instanceId}] Activity ${api.id} has a timer event.`);

            await this.saveQueue.enqueue(instanceId, async () => {
                await this.saveToDatabase(await this.saveEngineState(instanceId, "Timer started"), instanceId, {
                    skipStop: true,
                    metadata: {timer: true}
                });
            })
        });

        this.listener.on('activity.end', async (api, engine) => {
            printer.red(`[${instanceId}] Activity ${api.id} has ended.`);

            if (api.type === 'bpmn:EndEvent') {
                //TODO continue here, check if it's necessary to add a way to determine which end event is the 'correct' one, know if it should trigger the promise resolution, if it should delete all states, if it should save, if it should find a way to resume back to before the error (maybe this is on the modeler...). idk dude, think of something
                console.log("END EVENT: ");
                console.log(api);
            }

            if (api.type === 'bpmn:EndEvent' && api?.owner?.parent?.type === 'bpmn:Process') {
                console.log(`[${instanceId}] Process for instance ${instanceId} has completed.`);
                if (!this.maintainState) {
                    setTimeout(async () => {
                        await this.#deleteSavedState(instanceId);
                    }, 5000);
                }
                //this.#deleteSavedState(instanceId);
            }

            if (this.#errorHandlers(instanceId).has(api.id)) {
                this.#errorHandlers(instanceId).delete(api.id);
            }

            if (this.#signaledTasks(instanceId).has(api.id)) {
                this.#signaledTasks(instanceId).delete(api.id);
                if (!this.#errorThrown(instanceId)) {
                    this.#completeEngine(instanceId, 'Promise being resolved, task signaled.');
                } else {
                    return;
                }
                if (this.#pendingTasks(instanceId).size > 0) {
                    //await this.saveToDatabase(await this.saveEngineState(instanceId, "Other pending tasks"), instanceId, true);
                    await this.saveQueue.enqueue(instanceId, async () => {
                        await this.saveToDatabase(await this.saveEngineState(instanceId, api.id), instanceId, {skipStop: "skip"});
                    });
                } else {
                    console.log("No pending tasks found.");
                }
            } else if (this.#getActivityType(api) === 'task') {
                printer.yellow("Saving on successful activity end...")
                await this.saveQueue.enqueue(instanceId, async () => {
                    await this.saveToDatabase(await this.saveEngineState(instanceId, api.id), instanceId, {skipStop: "skip"});
                });
                // await this.saveToDatabase(await this.saveEngineState(instanceId, api.id), instanceId, true);
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
        if (this.#errorThrown(instanceId)) {
            return;
        }
        const engine = this.#engine(instanceId);
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
     * @param serializedStart - Serialized start object which contains the flow name, instance ID, and task ID to signal.
     * @param {Object} options - Options to resume the engine.
     * @param {string} options.instanceId - Unique identifier for the process instance.
     * @param {function} [options.callback] - Optional callback for custom handling of user tasks.
     * @param {string || null} [options.taskIdToSignal] - Optional task ID to signal after resuming the engine.
     */

    async resumeFlow(serializedStart = null, {instanceId, flowName, callback = null, taskIdToSignal = null, }) {


        if (serializedStart) {
            const object = JSON.parse(Buffer.from(serializedStart, 'base64').toString('utf-8'));

            flowName = object.flowName;
            taskIdToSignal = object.taskIdToSignal;
            instanceId = object.instanceId;
        }

        const previousInstance = this.#engine(instanceId);

        if (previousInstance) {
            this.#setErrorThrown(instanceId, true);
            this.stopEngine(instanceId);
            this.#setErrorThrown(instanceId, false);
        }

        const resume = async () => {

            if (!flowName) {
                throw new Error('Flow name is required to start the engine.');
            }

            console.log(`[${instanceId}] Resuming the engine...`);

            console.log("About to restart engine...");

            const {bpmnXml: source, services: loadedServices} = await this.#loadBpmnAndServices(flowName);

            const loadedState = await this.loadEngineState(instanceId);

            const engine = Engine().recover(loadedState, {
                moddleOptions: {
                    camunda,
                },
                extensions,
                services: this.#wrapServices(loadedServices),
            });

            const listener = this.listener || new EventEmitter();

            this.#initializeEngineState(instanceId, engine);

            this.attachListeners(engine, instanceId);

            listener.once('wait', async (api, engine) => {
                console.log(`[${instanceId}] Engine is waiting on a task...`);

                if (callback) {
                    callback(this.#wrapApi(api, engine), engine);
                }
            });

            console.log("Reaching critical point...");

            this.#setErrorThrown(instanceId, false);

            if (taskIdToSignal) {
                this.#signaledTasks(instanceId).add(taskIdToSignal);
            }

            const execution = await engine.resume({listener}, (err) => {
                if (err) {
                    console.error(`[${instanceId}] Error resuming the process:`, err);
                    if (this.engineStateMap.has(instanceId)){
                        this.#terminateEngineState(instanceId)
                    }
                } else {
                    console.log(`[${instanceId}] 1. Process resumed for instance ${instanceId}.`);
                }
            });

            if (!execution) {
                console.error(`[${instanceId}] No execution found for instance ${instanceId}`);
                return;
            }

            if (taskIdToSignal) {
                let matchedTask = null;

                execution?.getPostponed().forEach(task => {
                    if (task.type.includes("SubProcess")) {
                        const subTask = task.getPostponed().find(subTask => subTask.id === taskIdToSignal);

                        task.getPostponed().forEach(subTask => {
                            if (subTask.id !== taskIdToSignal && !subTask.type.includes("SubProcess")) {
                                this.#pendingTasks(instanceId).add(subTask.id);
                            }
                        });

                        if (subTask) {
                            matchedTask = subTask;
                        }
                    } else {
                        if (task.id !== taskIdToSignal && !task.type.includes("SubProcess") && this.#getActivityType(task) === 'task') {
                            this.#pendingTasks(instanceId).add(task.id);
                        }

                        if (task.id === taskIdToSignal) {
                            matchedTask = task;
                        }
                    }
                });

                if (matchedTask) {
                    printer.orange(`[${instanceId}] Signaling task with id ${taskIdToSignal}`);

                    matchedTask.signal(Object.keys(execution.environment.output)?.length > 0 ? execution.environment?.output : null, {id: taskIdToSignal});

                    this.#pendingTasks(instanceId).delete(taskIdToSignal);
                } else {
                    this.#signaledTasks(instanceId).delete(taskIdToSignal);
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

        function getSerialized() {
            const object = {
                instanceId: engine.name.replace('bpmn-engine-', ''),
                flowName: api.environment.variables.flowName,
                taskIdToSignal: api.id,
            };

            return Buffer.from(JSON.stringify(object)).toString('base64');
        }

        const wrappedApi = Object.create(Object.getPrototypeOf(api), Object.getOwnPropertyDescriptors(api));

        wrappedApi.emitSignal = emitSignal;
        wrappedApi.set = set;
        wrappedApi.setMany = setMany;
        wrappedApi.get = get;
        wrappedApi.getMany = getMany;
        wrappedApi.getSerialized = getSerialized;

        return wrappedApi;
    }

    /**
     * Load the state of the engine for a specific process instance.
     * @param instanceId - Unique identifier for the process instance.
     * @param version - The version of the state to load. If not provided, the latest state will be loaded. If it's zero, the initial state will be loaded. If it's a negative number, the state will be loaded based on the order of versions, from the latest to the oldest.
     * @returns {any} The state of the engine.
     */


    async loadEngineState(instanceId, version = null) {
        let state = null;

        await this.storage.load(instanceId, version).then((loadedState) => {
            console.log(`Loaded state for instance ${instanceId}`);
            state = loadedState.data;
        }).catch((e) => {
            console.error('Error loading state:', e);
        });

        return state;
    }

    getUnfinishedProcesses() {
        return this.storage.getUnfinishedProcesses();
    }

    getTimerAwaitingProcesses() {
        return this.storage.getUnfinishedProcesses({timer: true});
    }

    /**
     * Stop the engine for a specific instance.
     * @param {string} instanceId - Unique identifier for the process instance.
     */
    stopEngine(instanceId) {
        const engine = this.#engine(instanceId);
        if (engine) {
            engine.stop();
            console.log(`Engine stopped for instance ${instanceId}`);
            if (!this.#errorThrown(instanceId)) {
                this.#completeEngine(instanceId, 'Promise being resolved, engine stopped.');
                this.#setErrorThrown(instanceId, true); // Just to test if this stops the engine from being stopped and then a second save is called.
            }
            this.#terminateEngineState(instanceId);
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

    async #adjustSource(source) {

        const objectFromXml = await parseStringPromise(source, {});

        const transform = (process) => {
            if (process['bpmn:serviceTask']) {
                const newServices = [];
                for (let currentNode of process['bpmn:serviceTask']) {
                    const implementation = currentNode['$']['camunda:expression']
                    const object = {
                        ...currentNode,
                        '$': {
                            ...currentNode['$'],
                            'implementation': `\${environment.services.${implementation.replaceAll('.', '-')}}`,
                            // This line above is to allow the service to be called from the environment.services object even though services are being inserted with '-' instead of '.'
                            // otherwise they were trying to access the directory as if it was an object (e.g. "testDir.testFile", the engine would expect testDir to be an existing service in the environment.services object)
                        },
                    }
                    delete object['$']['camunda:expression'];
                    newServices.push(object);
                }
                process['bpmn:serviceTask'] = newServices;
            }

            if (process['bpmn:sequenceFlow']) {
                for (let sequenceFlow of process['bpmn:sequenceFlow']) {
                    if (sequenceFlow['bpmn:conditionExpression']?.[0]) {
                        const condition = sequenceFlow['bpmn:conditionExpression'][0]._;
                        sequenceFlow['bpmn:conditionExpression'][0] = {
                            ...sequenceFlow['bpmn:conditionExpression'][0],
                            '_': `\${environment.variables.conditionResolver('${condition}')}`,
                        };
                    }
                }
            }

            if (process['bpmn:subProcess']) {
                for (let subProcess of process['bpmn:subProcess']) {
                    transform(subProcess);
                }
            }
        }

        if (objectFromXml['bpmn:definitions']['bpmn:process']) {
            for (let process of objectFromXml['bpmn:definitions']['bpmn:process']) {
                transform(process);
            }
        }

        const builder = new Builder();
        return builder.buildObject(objectFromXml);
    }

    /**
     * Load the BPMN XML and services file for a specific flow.
     * @param flowName - The name of the flow (directory name).
     * @returns {Promise<{services: *, bpmnXml: null}>}
     */

    async #loadBpmnAndServices(flowName) {
        try {
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

            const sharedServices = await this.#loadHandlers();

            const serviceTree = await this.#loadHandlers(path.join(this.config_path, flowName, 'handlers'));

            const activityHandlers = await this.#loadHandlers(path.join(this.config_path, flowName, 'activity-helpers'));

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

    async #loadHandlers(directPath = null) {
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

    #engine(instanceId) {
        return this.engineStateMap.get(instanceId)?.engine;
    }

    #errorThrown(instanceId) {
        const error = this.engineStateMap.get(instanceId)?.errorThrown;
        if (error === undefined) {
            return true;
        }
        return error;
    }

    #setErrorThrown(instanceId, value) {
        const state = this.engineStateMap.get(instanceId);
        if (!state) {
            return;
        }
        state.errorThrown = value;
    }

    #signaledTasks(instanceId) {
        return this.engineStateMap.get(instanceId)?.signaledTasks;
    }

    #pendingTasks(instanceId) {
        return this.engineStateMap.get(instanceId)?.pendingTasks;
    }

    #errorHandlers(instanceId) {
        const errorHandlers = this.engineStateMap.get(instanceId)?.errorHandlers;
        if (!errorHandlers) {
            return new Set();
        }
        return errorHandlers;
    }

    #terminateEngineState(engineId) {
        this.engineStateMap.delete(engineId);
    }

}

export {BPMNEngineManager};

const BPMNEngineContext = {
    get variables() {
        return ContextStore.getStore().variables
    },
    get previousOutput() {

    }
}

export {BPMNEngineContext};
