import {Engine} from 'bpmn-engine';
import {EventEmitter} from 'events';
import {fileURLToPath} from "node:url";
import {createRequire} from "node:module";
import {printer} from "./functions.js";
import * as fs from "fs";
import * as path from "path";
import {pathToFileURL} from "node:url";
import {dirname, join} from 'path';

import {AsyncLocalStorage} from "node:async_hooks";

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
    constructor() {
        this.engines = new Map();
        this.listener = new EventEmitter();
        this.activityHandlers = {};
        this.serviceWrappers = {};
        this.saveToDatabase = this.#saveToDatabase;
        this.signaledTasks = new Set();
        this.pendingTasks = new Set();
    }

    /**
     * Register handlers for different BPMN activity types.
     * @param {Object} handlers - An object where keys are activity types and values are handler functions.
     */
    registerActivityHandlers(handlers) {
        this.activityHandlers = {...this.activityHandlers, ...handlers};
    }

    /**
     * Register service wrappers that will inject executionContext and ensure callback is called.
     * @param {Object} wrappers - An object where keys are service names and values are wrapper functions.
     */
    registerServiceWrappers(wrappers) {
        this.serviceWrappers = {...this.serviceWrappers, ...wrappers};
    }

    /**
     * Save the current state of the engine to a file.
     * @param state - The state of the engine.
     * @param instanceId - Unique identifier for the process instance.
     * @param skipStop - Whether to skip stopping the engine before saving the state.
     *
     */

    #saveToDatabase = (state, instanceId, skipStop = false) => {
        console.log('Saving state to database...');

        if (!skipStop) {
            this.stopEngine(instanceId);
        }

        const folderPath = 'src/saved';
        let fileName = `${instanceId}.json`;
        let filePath = path.join(folderPath, fileName);
        let fileIndex = 0;

        while (fs.existsSync(filePath)) {
            fileIndex++;
            fileName = `${instanceId}_${fileIndex}.json`;
            filePath = path.join(folderPath, fileName);
        }

        fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
        console.log(`State saved to src/saved/${fileName}`);
    }

    /**
     * Delete all saved state files for a specific process instance.
     * @param instanceId - Unique identifier for the process instance.
     *
     */

    #deleteSavedState = (instanceId) => {
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
     * @param {Object} [options.activityHandlers] - Optional activity handlers for specific tasks.
     */
    async startEngine({flowName, variables = {}, instanceId, activityHandlers = {}}) {
        const start = async () => {
            if (!flowName) {
                throw new Error('Flow name is required to start the engine.');
            }

            const {bpmnXml: source, services: loadedServices} = await this.#loadBpmnAndServices(flowName);

            if (Object.keys(activityHandlers).length > 0) {
                this.registerActivityHandlers(activityHandlers);
            }

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
        return new Promise(async (resolve, reject) => {
            ContextStore.run({flowName, variables, instanceId}, async () => {
                try {
                    resolve(await start());
                } catch (e) {
                    reject(e);
                }
            });
        });
    }

    /**
     * Wrap service tasks to inject executionContext and ensure callback is called.
     * @param {Object} services - Original service handlers.
     * @returns {Object} Wrapped service handlers.
     */
    #wrapServices(services) {
        const wrappedServices = {};

        for (const [serviceName, serviceFn] of Object.entries(services)) {
            wrappedServices[serviceName] = this.#wrapServiceFunction(serviceFn);
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

    #wrapServiceFunction(serviceFn) {
        let handle = function (executionContext, callback, args = []) {
            if (typeof executionContext === "string")
                return (context, cbk) => handle(context, cbk, ...[executionContext, callback]);

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

            const params = {
                context: executionContext,
                args,
                set,
                get,
                setMany
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
            if (api.content.isRecovered) {
                printer.orange("Skipping due to being recovered");
            } else {
                console.log(`[${instanceId}] Activity ${api.id} (${api.type}) is waiting for input.`);

                const handler = this.activityHandlers[api.id] || this.activityHandlers[api.name] || this.activityHandlers[api.type?.replace('bpmn:', '')];

                if (handler) {
                    let result = await handler(this.#wrapApi(api, engineApi));
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

            if (!this.signaledTasks.has(api.id)) {
                // console.log("Saving...");
                // await this.saveToDatabase(await this.saveEngineState(instanceId, api.id), instanceId);
            }
        });

        this.listener.on('activity.error', (api, error) => {
            console.error(`[${instanceId}] Error in activity ${api.id}:`, error);
        });

        this.listener.on('activity.signal', (api) => {
            printer.green("Signaling the activity...")
            printer.orange("Signaling the activity...")
            printer.red("Signaling the activity...")
        });

        this.listener.on('activity.start', (api) => {
            printer.green(`[${instanceId}] Activity ${api.id} started.`);

            if (api.type === 'bpmn:ParallelGateway') {
                //Need the id of the activities it's going to wait for
                // console.log("GATEWAY");
                // console.log(api);
            }
        });

        this.listener.on('activity.end', async (api, engine) => {
            printer.red(`[${instanceId}] Activity ${api.id} has ended.`);

            if (api.type === 'bpmn:EndEvent' && api.id === 'final') {
                console.log(`[${instanceId}] Process for instance ${instanceId} has completed.`);
                setTimeout(() => {
                    this.#deleteSavedState(instanceId);
                }, 5000);
                //this.#deleteSavedState(instanceId);
            }


            if (this.signaledTasks.has(api.id)) {
                this.signaledTasks.delete(api.id);
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
            console.log(`[${instanceId}] Flow taken from ${flow.content.sourceId} to ${flow.content.targetId}`);
        });

    }

    /**
     * Save the current state of the engine for a specific process instance.
     * @param {string} instanceId - The unique identifier for the process instance.
     * @param causedBy - The reason for saving the state.
     */
    async saveEngineState(instanceId, causedBy = "") {
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
     * @param {Object} [options.activityHandlers] - Optional activity handlers for specific tasks.
     * @param {string || null} [options.taskIdToSignal] - Optional task ID to signal after resuming the engine. TODO May need to make this mandatory.
     */

    async resumeEngine({instanceId, flowName, callback = null, activityHandlers = {}, taskIdToSignal = null}) {

        if (!flowName) {
            throw new Error('Flow name is required to start the engine.');
        }

        if (Object.keys(activityHandlers).length > 0) {
            this.registerActivityHandlers(activityHandlers);
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

            // for (const [key, value] of Object.entries(variablesToInsert?.before || {})) {
            //     console.log("Inserting: ", key, value)
            //     api.environment.output[key] = value;
            // }

            if (callback) {
                callback(this.#wrapApi(api, engine), engine);
            }

            // for (const [key, value] of Object.entries(variablesToInsert?.after || {})) {
            //     api.environment.variables[key] = value;
            // }
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
        const regex = /<bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">(.*?)<\/bpmn:conditionExpression>/g;

        return source?.replaceAll('camunda:expression', 'implementation')
        //     ?.replaceAll(regex, (match, condition) => {
        //     const transformedCondition = `next(null, ${condition.trim().replace(/==/g, '===')});`;
        //
        //     printer.yellow(`Transformed condition: ${transformedCondition}`)
        //
        //     return `<bpmn:conditionExpression xsi:type="bpmn:tFormalExpression" language="javascript">${transformedCondition}</bpmn:conditionExpression>`;
        // });
    }

    /**
     * Load the BPMN XML and services file for a specific flow.
     * @param flowName - The name of the flow (directory name).
     * @returns {Promise<{services: *, bpmnXml: null}>}
     */

    async #loadBpmnAndServices(flowName) {
        try {
            const baseDirectory = path.join(__dirname, 'bpmn-flows');

            const directoryPath = path.join(baseDirectory, flowName);

            if (!fs.existsSync(directoryPath)) {
                throw new Error(`Directory not found: ${directoryPath}`);
            }

            const files = await fs.promises.readdir(directoryPath);

            const bpmnFile = files.find(file => path.extname(file) === '.bpmn');
            let bpmnXml = null;

            if (bpmnFile) {
                const bpmnFilePath = path.join(directoryPath, bpmnFile);
                bpmnXml = await fs.promises.readFile(bpmnFilePath, 'utf-8');
            }

            const jsFile = files.find(file => path.extname(file) === '.js');

            if (!jsFile) {
                throw new Error('No services (.js) file found in the directory.');
            }

            const servicesFilePath = path.join(directoryPath, jsFile);
            const servicesFileUrl = pathToFileURL(servicesFilePath).href;

            const servicesModule = await import(servicesFileUrl);

            const services = servicesModule.default || servicesModule;

            return {
                bpmnXml,
                services
            };
        } catch (error) {
            console.error('Error loading BPMN or services file:', error);
            throw error;
        }
    }


}

const bpmnEngineManager = new BPMNEngineManager();
export default bpmnEngineManager;

const BPMNEngineContext = {
    get variables() {
        return ContextStore.getStore().variables
    },
    get previousOutput() {

    }
}

export {BPMNEngineContext};
