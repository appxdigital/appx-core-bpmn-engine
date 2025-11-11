# Appx Core BPMN Engine

A lightweight Node.js BPMN 2.0 workflow engine compatible with Camunda Modeler 7.

**Key features**
- ✅ Compatible with Camunda Modeler 7 BPMN XML
- ✅ FileStore & PrismaStore support (pluggable storage)
- ✅ Service tasks, user tasks, timers, gateways, subprocesses
- ✅ Pause/resume flows with `instanceId` and serialized state
- ✅ Designed for dynamic, long-running workflows

Appx Core BPMN Engine provides a powerful workflow engine that allows developers to visualize and automate their business processes using the BPMN (Business Process Model and Notation) standard. It supports Camunda Modeler 7 XML files, allowing users to design their processes, link them to custom handlers, and integrate timers, user tasks, service tasks, and gateways to streamline complex workflows. This engine is designed for ease of integration, flexibility, and dynamic process management.

## Table of Contents

- [What is BPMN?](#what-is-bpmn)
- [General Aspects of Implementation](#general-aspects-of-implementation)
- [Gateways](#gateways)
- [Service Tasks](#service-tasks)
- [User Tasks](#user-tasks)
- [Timers](#timers)
- [Error Boundary](#error-boundary)
- [Subprocess](#subprocess)
- [Sequence Flow](#sequence-flow)
- [Variables](#variables)
- [License](#license)
  
## What is BPMN?

BPMN (Business Process Model and Notation) is a graphical representation for specifying business processes in a workflow. It provides a standard way to visualize and document the steps in a business process.

Using Appx Core BPMN Engine, clients can visualize their flow and understand the steps involved in their process, partnering with developers to bring their ideas to life.

## General Aspects of Implementation

To implement the Appx Core BPMN Engine:

Design your BPMN flow using the free tool Camunda Modeler 7 and export it as a .bpmn file.

Organize the folder structure:
- bpmn-flows (example) folder at root level
  - Each flow has a folder with:
    - handlers folder: Contains the logic for the BPMN flow (JavaScript files or subfolders).
    - activity-helpers folder: Contains functions to be run before or after user tasks.
    - One .bpmn file representing the flow.
  - Optionally, include a shared-functions folder for reusable functions across multiple flows.

The engine uses the instanceId to track process instances and the storage for saving the state (e.g., FileStore or PrismaStore). 

Each process will start with a Start Event and conclude with an End Event. In between, you can have different types of tasks, gateways, timers and events, all linked through sequence flows. Below you'll find a brief explanation of each.

## Gateways

Gateways control the divergence and convergence of sequence flows. They determine how the process flow splits or merges.

**Inclusive Gateway** - Activates one or more outgoing flows depending on the defined conditions. All active incoming paths must complete before proceeding.

**Exclusive Gateway** - Only one outgoing flow is taken based on conditions. It follows the first condition that evaluates to true. If none match, the default flow is taken.

**Parallel Gateway** - Used to fork or join parallel flows. All outgoing flows are activated simultaneously, and incoming flows must all complete before proceeding.

## Service Tasks

A Service Task represents a task in the process performed by a service. This can include actions like sending emails, making API calls, or updating a database.

In Appx Core BPMN Engine, you can define the behaviour of the service using expressions, for example:

*users.register.sendEmail* - The corresponding logic resides in the users/register.js file with a service named sendEmail.

These will receive one single parameter, which will include a number of methods to interact with engine variables as seen in [Variables](#variables).

After one of these has concluded successfully, the engine will perform a save to the provided storage (while incrementing the version) without triggering a stoppage of the process.

## User Tasks

A User Task is performed by a human user, such as reviewing or approving a document. It involves interaction will result in engine stoppage until a signal is received to resume the flow.

You can define services (from activity-helpers) to run before or after the user task execution. 

In Camunda Modeler 7, when selecting a user task, you can click on 'Execution listeners' and add one of type 'Expression', while selecting if it should happen before or after the stoppage.

If there's a Start service, it will be triggered and then process will be paused until the user task is resumed by sending the proper signal.

When signaling a user task, use resumeFlow with the correct instanceId. You can pass a serialized state by calling params.getSerialized() and passing on through the service you define as the 'start' of that user task (e.g. send an email to a user with a link that includes the serializedStart and on click have it redirect to an endpoint that will resume the engine using that signal).

When it's signaled and resumes the process, it will look for an End service and if there's one, it will execute it. When it's finished, as it terminates and before allowing the flow to progress, it will resolve the promise of the resumeFlow function, allowing for implementation of any confirmation mechanism of success of the resuming.

These will receive one single parameter, which will include a number of methods to interact with engine variables as seen in [Variables](#variables).

## Timers

Timers can pause the process for a specific duration or wait until a certain time before continuing. Time is defined in the ISO 8601 format, such as:

- PT1M (1 minute)
- PT1H (1 hour)
- PT1D (1 day)

For example: *PT2H23M10S* - will wait for 2 hours, 23 minutes and 10 seconds before continuing.

Timers can be attached as boundary events or used as intermediate events to wait before proceeding.

## Error Boundary

If an error is thrown/occurs on a service without an Error Boundary Event, it will reject the startFlow/resumeFlow promise and stop without saving.

But you can attach an Error Boundary Event to a specific service. This allows you to define alternative paths when errors happen during that task's execution, ensuring proper recovery or notification.

## Subprocess

A Subprocess is a sequence of tasks encapsulated within a larger process. It helps to simplify complex workflows by breaking them down into smaller, more manageable parts.

A subprocess contains its own Start Event, End Event, and tasks. The subprocess ends only when all tasks inside it are completed.

## Sequence Flow

Sequence Flows show the order of activities in a process. There are three types of sequence flows:

- Normal Flow: No condition is needed; the process moves to the next task.
- Conditional Flow: Follows a path only if a condition is met (evaluated by a service).
- Default Flow: Follows a default path when no other conditions are met (indicated by a backslash on the diagram).
  
## Variables

Variables can be inserted into the flow either through the engine or inside handlers. The only way to insert "initialVariables" into the engine is through the starting mechanism, as startFlow will take 'variables' as part of the second argument options. These should be inserted as an object with key-value pairs.

During the process, you can set variables using set() or setMany() and retrieve them using get() or getMany(). These will be inserted into the task isolated environment and at the end of execution, will be saved to the engine variables.

You can also use returning() in services to store values without specifying a key, which can be retrieved later by using getReturn() which will take the ID of the desired task's return as an argument.

## Getting Started

To get started with the Appx Core BPMN Engine, follow these steps:

Install the package by running: npm install appx-core-bpmn-engine --registry=http://npm.appx.pt/

Import the engine, you can do so by placing the following on the top of your file: 

> import { BPMNEngineManager } from "appx-core-bpmn-engine";

As previously mentioned, you'll then need a storage configuration for FileStore or PrismaStore, it will look something like this:

> const sessionsDir = path.join(__dirname, 'bpmn-saves');
> 
> const storage = new FileStoreSession({ path: path.join(__dirname, 'bpmn-saves'), logFn: function() {} });

Next, it's time to add the config_path, the path to the folder where you'll include all your flows and shared functions, here's an example for the engine manager initialization:

> const bpmnEngineManager = new BPMNEngineManager({
    config_path: path.join(__dirname, 'bpmn-flows'),
    storage: storage,
});

Design your BPMN flow using Camunda Modeler 7, copy the resulting XML and set up the folder structure as explained above.

Prepare a storage mechanism like FileStore or PrismaStore and pass the storage. In theory, the interface implemented to interact with storages allows all that share the same API as the previously mentioned (.get, .set, .list/.ids, .destroy), but only those two have been tested.

Start the engine with your BPMN file and use startFlow to kick off your process.

## License

This project is licensed under the terms of the
[GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.en.html).

You are free to use, modify, and distribute this software, provided that
any derivative works are also licensed under the same GPL terms.
