import * as fs from "fs";
import * as path from "path";
import {BPMNEngineManager} from "./src/bpmn-engine.js";
import { fileURLToPath } from 'url';
import session from 'express-session';
import FileStore from 'session-file-store';
import express from 'express';


const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SessionFileStore = FileStore(session);


const sessionsDir = path.join(__dirname, 'sessions');

if (!fs.existsSync(sessionsDir)){
    fs.mkdirSync(sessionsDir);
}

const storage = new SessionFileStore({ path: sessionsDir, logFn: function() {} });

// app.use(session({
//     store: storage,
//     secret: 'keyboard cat',
//     resave: false,
//     saveUninitialized: true,
// }));

const bpmnEngineManager = new BPMNEngineManager({
    config_path: path.join(__dirname, 'bpmn-flows'),
    storage: storage,
});

const randomProcessName = 'process-' + Math.floor(Math.random() * 1000);

bpmnEngineManager.startFlow('test-flow',
    {
    variables: {
        userNames: 'John Doe',
        testVariable : 'I am a test variable!',
    },
    instanceId: randomProcessName ||
        'process-123',
})
    .then(c => {
    console.log("IT HAS FINISHED!", c);
}).catch(err => {
    console.log("ERROR HAS OCCURRED!", err);
});

// const PORT = 3000;
// app.listen(PORT, () => {
//     console.log(`Server is running on http://localhost:${PORT}`);
// });
