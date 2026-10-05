const express = require('express');
const formidable = require('formidable');
const fs = require('fs/promises');
const app = express();
const PORT = 3000;

const Timer = require('./Timer');
const CloneDetector = require('./CloneDetector');
const CloneStorage = require('./CloneStorage');
const FileStorage = require('./FileStorage');


// Express and Formidable stuff to receice a file for further processing
// --------------------
const form = formidable({multiples:false});

app.post('/', fileReceiver );
function fileReceiver(req, res, next) {
    form.parse(req, (err, fields, files) => {
        fs.readFile(files.data.filepath, { encoding: 'utf8' })
            .then( data => { return processFile(fields.name, data); });
    });
    return res.end('');
}

app.get('/', viewClones );
app.get('/timers', viewTimers);

const server = app.listen(PORT, () => { console.log('Listening for files on port', PORT); });


// Page generation for viewing current progress
// --------------------
function getStatistics() {
    let cloneStore = CloneStorage.getInstance();
    let fileStore = FileStorage.getInstance();
    let output = 'Processed ' + fileStore.numberOfFiles + ' files containing ' + cloneStore.numberOfClones + ' clones.'
    return output;
}

function lastFileTimersHTML() {
    if (!lastFile) return '';
    output = '<p>Timers for last file processed:</p>\n<ul>\n'
    let timers = Timer.getTimers(lastFile);
    for (t in timers) {
        output += '<li>' + t + ': ' + (timers[t] / (1000n)) + ' µs\n'
    }
    output += '</ul>\n';
    return output;
}

function listClonesHTML() {
    let cloneStore = CloneStorage.getInstance();
    let output = '';

    cloneStore.clones.forEach( clone => {
        output += '<hr>\n';
        output += '<h2>Source File: ' + clone.sourceName + '</h2>\n';
        output += '<p>Starting at line: ' + clone.sourceStart + ' , ending at line: ' + clone.sourceEnd + '</p>\n';
        output += '<ul>';
        clone.targets.forEach( target => {
            output += '<li>Found in ' + target.name + ' starting at line ' + target.startLine + '\n';
        });
        output += '</ul>\n'
        output += '<h3>Contents:</h3>\n<pre><code>\n';
        output += clone.originalCode;
        output += '</code></pre>\n';
    });

    return output;
}

function listProcessedFilesHTML() {
    let fs = FileStorage.getInstance();
    let output = '<HR>\n<H2>Processed Files</H2>\n'
    output += fs.filenames.reduce( (out, name) => {
        out += '<li>' + name + '\n';
        return out;
    }, '<ul>\n');
    output += '</ul>\n';
    return output;
}

function viewClones(req, res, next) {
    let page='<HTML><HEAD><TITLE>CodeStream Clone Detector</TITLE></HEAD>\n';
    page += '<BODY><H1>CodeStream Clone Detector</H1>\n';
    page += '<P><A href="/timers">View timing statistics</A></P>\n';
    page += '<P>' + getStatistics() + '</P>\n';
    page += lastFileTimersHTML() + '\n';
    page += listClonesHTML() + '\n';
    page += listProcessedFilesHTML() + '\n';
    page += '</BODY></HTML>';
    res.send(page);
}

function viewTimers(req, res, next) {
    let page = '<HTML><HEAD><TITLE>Timing Statistics</TITLE></HEAD>\n';
    page += '<BODY><H1>Timing Statistics</H1>\n';

    if (timerHistory.length === 0) {
        page += '<P>No timing data available yet.</P>\n';
        page += '<P><A href="/">Back to clones</A></P>\n';
        page += '</BODY></HTML>';

        return res.send(page);
    }

    let totalSum = timerHistory.reduce((sum, item) => sum + item.total, 0);
    let matchSum = timerHistory.reduce((sum, item) => sum + item.match, 0);

    let averageTotal = totalSum / timerHistory.length;
    let averageMatch = matchSum / timerHistory.length;

    let last100 = timerHistory.slice(-100);
    let last1000 = timerHistory.slice(-1000);

    let averageLast100 = last100.reduce((sum, item) => sum + item.total, 0) / last100.length;
    let averageLast1000 = last1000.reduce((sum, item) => sum + item.total, 0) / last1000.length;

    page += '<P>Files measured: ' + timerHistory.length + '</P>\n';

    page += '<P>Average total processing time: ' +
        averageTotal.toFixed(2) + ' µs</P>\n';

    page += '<P>Average match time: ' +
        averageMatch.toFixed(2) + ' µs</P>\n';

    page += '<P>Average total time for last 100 files: ' +
        averageLast100.toFixed(2) + ' µs</P>\n';

    page += '<P>Average total time for last 1000 files: ' +
        averageLast1000.toFixed(2) + ' µs</P>\n';

    page += '<H2>Processed Files</H2>\n';

    page += '<TABLE border="1">\n';

    page += '<TR>' +
        '<TH>#</TH>' +
        '<TH>File</TH>' +
        '<TH>Lines</TH>' +
        '<TH>Total time (µs)</TH>' +
        '<TH>Match time (µs)</TH>' +
        '<TH>Time per line (µs)</TH>' +
        '</TR>\n';

    timerHistory.forEach(item => {

        let timePerLine = item.lines > 0
            ? item.total / item.lines
            : 0;

        page += '<TR>';

        page += '<TD>' + item.number + '</TD>';
        page += '<TD>' + item.name + '</TD>';
        page += '<TD>' + item.lines + '</TD>';
        page += '<TD>' + item.total + '</TD>';
        page += '<TD>' + item.match + '</TD>';
        page += '<TD>' + timePerLine.toFixed(2) + '</TD>';

        page += '</TR>\n';
    });

    page += '</TABLE>\n';

    page += '<P><A href="/">Back to clones</A></P>\n';

    page += '</BODY></HTML>';

    res.send(page);
}


// Some helper functions
// --------------------
// PASS is used to insert functions in a Promise stream and pass on all input parameters untouched.
PASS = fn => d => {
    try {
        fn(d);
        return d;
    } catch (e) {
        throw e;
    }
};

const STATS_FREQ = 100;
const URL = process.env.URL || 'http://localhost:8080/';
var lastFile = null;

var timerHistory = [];

function storeTimerStatistics(file) {
    let timers = Timer.getTimers(file);

    timerHistory.push({
        number: timerHistory.length + 1,
        name: file.name,
        total: Number(timers.total / 1000n),
        match: Number(timers.match / 1000n),
        lines: file.lines ? file.lines.length : 0
    });

    return file;
}


function maybePrintStatistics(file, cloneDetector, cloneStore) {
    if (0 == cloneDetector.numberOfProcessedFiles % STATS_FREQ) {
        console.log('Processed', cloneDetector.numberOfProcessedFiles, 'files and found', cloneStore.numberOfClones, 'clones.');
        let timers = Timer.getTimers(file);
        let str = 'Timers for last file processed: ';
        for (t in timers) {
            str += t + ': ' + (timers[t] / (1000n)) + ' µs '
        }
        console.log(str);
        console.log('List of found clones available at', URL);
    }

    return file;
}

// Processing of the file
// --------------------
function processFile(filename, contents) {
    let cd = new CloneDetector();
    let cloneStore = CloneStorage.getInstance();

    return Promise.resolve({name: filename, contents: contents} )
        //.then( PASS( (file) => console.log('Processing file:', file.name) ))
        .then( (file) => Timer.startTimer(file, 'total') )
        .then( (file) => cd.preprocess(file) )
        .then( (file) => cd.transform(file) )

        .then( (file) => Timer.startTimer(file, 'match') )
        .then( (file) => cd.matchDetect(file) )
        .then( (file) => cloneStore.storeClones(file) )
        .then( (file) => Timer.endTimer(file, 'match') )

        .then( (file) => cd.storeFile(file) )
        .then( (file) => Timer.endTimer(file, 'total') )
        .then( PASS( (file) => storeTimerStatistics(file) ))
        .then( PASS( (file) => lastFile = file ))
        .then( PASS( (file) => maybePrintStatistics(file, cd, cloneStore) ))
        .catch( console.log );
};

/*
1. Preprocessing: Remove uninteresting code, determine source and comparison units/granularities
2. Transformation: One or more extraction and/or transformation techniques are applied to the preprocessed code to obtain an intermediate representation of the code.
3. Match Detection: Transformed units (and/or metrics for those units) are compared to find similar source units.
4. Formatting: Locations of identified clones in the transformed units are mapped to the original code base by file location and line number.
5. Post-Processing and Filtering: Visualisation of clones and manual analysis to filter out false positives
6. Aggregation: Clone pairs are aggregated to form clone classes or families, in order to reduce the amount of data and facilitate analysis.
*/