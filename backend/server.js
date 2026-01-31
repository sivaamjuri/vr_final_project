const express = require('express');
const cors = require('cors');
const multer = require('multer');
const AdmZip = require('adm-zip');
const path = require('path');
const fs = require('fs-extra');
const { chromium } = require('playwright');
const PNG = require('pngjs').PNG;
const pixelmatch = require('pixelmatch');
const { spawn } = require('child_process');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// Log all requests
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

// Setup directories
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const TEMP_DIR = path.join(__dirname, 'temp');

fs.ensureDirSync(UPLOADS_DIR);
fs.ensureDirSync(TEMP_DIR);

const upload = multer({ dest: UPLOADS_DIR });

// Helper: Find project root (contains package.json or index.html)
async function findProjectRoot(baseDir) {
    // Check top level
    if (await fs.pathExists(path.join(baseDir, 'package.json'))) return { path: baseDir, type: 'react' };
    if (await fs.pathExists(path.join(baseDir, 'index.html'))) return { path: baseDir, type: 'static' };

    const items = await fs.readdir(baseDir, { withFileTypes: true });
    const dirs = items.filter(item => item.isDirectory());

    // Check one level deep
    for (const dir of dirs) {
        const subDir = path.join(baseDir, dir.name);
        if (await fs.pathExists(path.join(subDir, 'package.json'))) return { path: subDir, type: 'react' };
        if (await fs.pathExists(path.join(subDir, 'index.html'))) return { path: subDir, type: 'static' };
    }

    throw new Error(`No project root (package.json or index.html) found in ${baseDir}`);
}

// Helper: Run npm install and start dev server
// Helper: Logging
function log(msg) {
    const logMsg = `[${new Date().toISOString()}] ${msg}\n`;
    console.log(msg);
    try {
        fs.appendFileSync(path.join(__dirname, 'server.log'), logMsg);
    } catch (e) {
        console.error("Failed to write to log file:", e);
    }
}

// Helper: Run server (React/Static)
function startServer(projectInfo, port) {
    const { path: projectDir, type } = projectInfo;

    return new Promise((resolve, reject) => {
        try {
            if (type === 'static') {
                log(`[${port}] Starting static server in ${projectDir}...`);
                const out = fs.openSync(path.join(projectDir, 'static-server.log'), 'a');
                const err = fs.openSync(path.join(projectDir, 'static-server.log'), 'a');

                // npx serve . -p <port>
                const serve = spawn('npx', ['-y', 'serve', '.', '-p', port.toString()], {
                    cwd: projectDir,
                    detached: true,
                    shell: true,
                    stdio: ['ignore', out, err]
                });

                serve.unref();
                checkServerReady(port, serve, resolve, reject);
                return;
            }

            // React/Vite/CRA logic
            const masterDir = path.join(__dirname, 'master_project');
            const masterModules = path.join(masterDir, 'node_modules');
            const targetModules = path.join(projectDir, 'node_modules');

            // Read package.json to find the right script and identify missing deps
            let studentPkg = {};
            let masterPkg = {};
            try {
                studentPkg = fs.readJsonSync(path.join(projectDir, 'package.json'));
                masterPkg = fs.readJsonSync(path.join(masterDir, 'package.json'));
            } catch (e) {
                log(`[${port}] Failed to read package.json files`);
            }

            // Global lock for learning to prevent race conditions
            if (global.isLearning === undefined) global.isLearning = false;

            const runStart = async () => {
                // Determine missing dependencies or version mismatches
                const studentDeps = { ...(studentPkg.dependencies || {}), ...(studentPkg.devDependencies || {}) };
                const masterDeps = { ...(masterPkg.dependencies || {}), ...(masterPkg.devDependencies || {}) };

                const stillMissing = [];
                for (const [dep, ver] of Object.entries(studentDeps)) {
                    const masterVer = masterDeps[dep];
                    const cleanVer = ver.replace(/[\^~]/g, '');

                    if (!masterVer) {
                        stillMissing.push(`${dep}@${cleanVer}`);
                        continue;
                    }

                    // Check for major version mismatch (e.g., v5 vs v6)
                    const sMajor = cleanVer.split('.')[0];
                    const mMajor = masterVer.replace(/[\^~]/g, '').split('.')[0];

                    if (sMajor !== mMajor && !isNaN(parseInt(sMajor)) && !isNaN(parseInt(mMajor))) {
                        log(`[${port}] Major version mismatch for ${dep}: Master (${mMajor}) vs Student (${sMajor}). Upgrading...`);
                        stillMissing.push(`${dep}@${cleanVer}`);
                    }
                }

                if (stillMissing.length > 0) {
                    // Wait if another process is learning
                    while (global.isLearning) {
                        await new Promise(r => setTimeout(r, 1000));
                    }

                    global.isLearning = true;
                    log(`[${port}] Learning/Upgrading dependencies: ${stillMissing.join(', ')}...`);
                    try {
                        const installResult = await new Promise((res) => {
                            const inst = spawn('npm', ['install', '--save', ...stillMissing, '--no-audit', '--no-fund', '--no-progress', '--legacy-peer-deps'], {
                                cwd: masterDir,
                                shell: true
                            });

                            let errOutput = '';
                            inst.stderr?.on('data', (data) => errOutput += data.toString());

                            inst.on('close', (code) => {
                                if (code !== 0) log(`[${port}] npm install warning/error: ${errOutput}`);
                                res(code);
                            });
                        });
                        log(`[${port}] Update complete. Result code: ${installResult}`);
                    } catch (e) {
                        log(`[${port}] Update failed: ${e.message}`);
                    } finally {
                        global.isLearning = false;
                    }
                }

                log(`[${port}] Using shared node_modules for speed...`);
                try {
                    await fs.ensureSymlink(masterModules, targetModules, 'junction');

                    // NEW: Start json-server if db.json or server.js exists (common in NxtWave assessments)
                    const dbPath = path.join(projectDir, 'db.json');
                    const customServerPath = path.join(projectDir, 'server.js');
                    if (await fs.pathExists(dbPath)) {
                        log(`[${port}] Starting mockup backend on port 8000...`);
                        const jsLogStream = fs.createWriteStream(path.join(projectDir, 'json-server.log'), { flags: 'a' });

                        let jsProc;
                        if (await fs.pathExists(customServerPath)) {
                            // Run the custom server.js if it exists
                            jsProc = spawn('node', ['server.js'], {
                                cwd: projectDir,
                                shell: true
                            });
                        } else {
                            // Fallback to basic json-server
                            jsProc = spawn('npx', ['json-server', '--watch', 'db.json', '--port', '8000'], {
                                cwd: projectDir,
                                shell: true
                            });
                        }

                        jsProc.stdout.on('data', (data) => jsLogStream.write(data));
                        jsProc.stderr.on('data', (data) => jsLogStream.write(data));
                        // Give it a moment to start
                        await new Promise(r => setTimeout(r, 2000));
                    }
                } catch (e) {
                    log(`[${port}] Symlink failed: ${e.message}`);
                    await new Promise((res) => {
                        const inst = spawn('npm', ['install', '--no-audit', '--no-fund', '--no-progress'], {
                            cwd: projectDir,
                            stdio: 'ignore',
                            shell: true
                        });
                        inst.on('close', res);
                    });
                }

                log(`[${port}] Starting server...`);
                const logPath = path.join(projectDir, 'dev-server.log');
                const logStream = fs.createWriteStream(logPath, { flags: 'a' });

                // Determine command
                let cmd = 'dev';
                if (!studentPkg.scripts?.dev && studentPkg.scripts?.start) {
                    cmd = 'start';
                }

                // Determine base path from homepage if it exists
                let basePath = '';
                if (studentPkg.homepage && studentPkg.homepage.startsWith('http')) {
                    try {
                        const url = new URL(studentPkg.homepage);
                        basePath = url.pathname === '/' ? '' : url.pathname;
                        if (basePath.endsWith('/')) basePath = basePath.slice(0, -1);
                    } catch (e) {
                        log(`[${port}] Failed to parse homepage URL: ${studentPkg.homepage}`);
                    }
                } else if (studentPkg.homepage && studentPkg.homepage.startsWith('/')) {
                    basePath = studentPkg.homepage;
                    if (basePath.endsWith('/')) basePath = basePath.slice(0, -1);
                }

                // Browser-related envs to prevent opening browser windows
                const env = {
                    ...process.env,
                    PORT: port.toString(),
                    BROWSER: 'none',
                    HOST: '127.0.0.1',
                    CI: 'true',
                    WDS_SOCKET_PORT: port.toString(),
                    SKIP_PREFLIGHT_CHECK: 'true',
                    NODE_OPTIONS: '--openssl-legacy-provider'
                };

                const args = ['run', cmd];
                if (cmd === 'dev') {
                    args.push('--', '--port', port.toString(), '--host');
                }

                const serverProc = spawn('npm', args, {
                    cwd: projectDir,
                    shell: true,
                    env: env
                });

                serverProc.stdout.on('data', (data) => logStream.write(data));
                serverProc.stderr.on('data', (data) => logStream.write(data));

                checkServerReady(port, basePath, serverProc, resolve, reject);
            };

            runStart();

        } catch (e) {
            log(`[${port}] Setup failed: ${e.message}`);
            reject(e);
        }
    });
}

function checkServerReady(port, basePath, serverProcess, resolve, reject) {
    let attempts = 0;
    const maxAttempts = 180; // 3 minutes

    const check = async () => {
        // Check if the process has exited
        if (serverProcess.exitCode !== null) {
            log(`[${port}] Server process exited early with code ${serverProcess.exitCode}`);
            return reject(new Error(`Server process on port ${port} exited early with code ${serverProcess.exitCode}. Check dev-server.log.`));
        }

        if (attempts >= maxAttempts) {
            log(`[${port}] Server startup timed out after ${maxAttempts}s`);
            return reject(new Error(`Timeout waiting for server on port ${port}`));
        }
        attempts++;

        if (attempts % 10 === 0) {
            log(`[${port}] Still waiting for server... (${attempts}s)`);
        }

        try {
            const url = `http://127.0.0.1:${port}${basePath}`;
            await fetch(url);
            log(`[${port}] Server ready at ${url}`);
            resolve({ process: serverProcess, baseUrl: url });
        } catch (e) {
            setTimeout(check, 1000);
        }
    };
    check();
}

// Helper: Capture Screenshots
async function captureScreenshots(baseUrl, routes, outputDir) {
    await fs.ensureDir(outputDir);
    const browser = await chromium.launch();
    const page = await browser.newPage();

    for (const route of routes) {
        const url = `${baseUrl}${route}`;
        // Handle route name for file (remove slashes)
        const fileName = route === '/' ? 'index.png' : `${route.replace(/\//g, '')}.png`;
        const savePath = path.join(outputDir, fileName);

        try {
            log(`Navigating to ${url}...`);
            await page.setViewportSize({ width: 1280, height: 800 });
            await page.goto(url, { waitUntil: 'networkidle' });

            // Inject CSS to disable animations/transitions
            await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; caret-color: transparent !important; }' });

            // Wait a moment for any dynamic layout to settle
            await page.waitForTimeout(1000);

            await page.screenshot({ path: savePath, fullPage: true });
        } catch (e) {
            console.error(`Failed to capture ${url}:`, e);
        }
    }

    await browser.close();
}

// Helper: Normalize image size by padding with transparency
function normalizeImage(img, width, height) {
    if (img.width === width && img.height === height) return img;
    const newImg = new PNG({ width, height });
    // PNG default is transparent/black (0,0,0,0)
    // Copy original image data into the top-left of the new larger canvas
    img.bitblt(newImg, 0, 0, img.width, img.height, 0, 0);
    return newImg;
}

// Helper: Compare Images
function compareImages(img1Path, img2Path, diffOutputPath) {
    try {
        if (!fs.existsSync(img1Path) || !fs.existsSync(img2Path)) {
            log(`Image missing: ${img1Path} or ${img2Path}`);
            return "0.00";
        }

        const img1 = PNG.sync.read(fs.readFileSync(img1Path));
        const img2 = PNG.sync.read(fs.readFileSync(img2Path));

        const width = Math.max(img1.width, img2.width);
        const height = Math.max(img1.height, img2.height);

        // Normalize images to the same size
        const normImg1 = normalizeImage(img1, width, height);
        const normImg2 = normalizeImage(img2, width, height);

        const diff = new PNG({ width, height });

        const numDiffPixels = pixelmatch(
            normImg1.data,
            normImg2.data,
            diff.data,
            width,
            height,
            { threshold: 0.1, includeAA: true }
        );

        // Save diff image
        fs.writeFileSync(diffOutputPath, PNG.sync.write(diff));

        const totalPixels = width * height;
        const similarity = (1 - (numDiffPixels / totalPixels)) * 100;

        log(`Similarity calculated: ${similarity.toFixed(2)}% (Dimensions: ${width}x${height})`);
        return similarity.toFixed(2);
    } catch (e) {
        log(`compareImages error: ${e.message}`);
        return "0.00";
    }
}


// Serve static files from temp to show screenshots
app.use('/temp', express.static(TEMP_DIR));

app.post('/compare', upload.fields([{ name: 'solution' }, { name: 'student' }]), async (req, res) => {
    const solutionFile = req.files['solution']?.[0];
    const studentFile = req.files['student']?.[0];

    if (!solutionFile || !studentFile) {
        return res.status(400).json({ error: 'Both solution and student zip files are required.' });
    }

    const runId = Date.now().toString();
    const runDir = path.join(TEMP_DIR, runId);
    const solExtractDir = path.join(runDir, 'solution_raw');
    const stuExtractDir = path.join(runDir, 'student_raw');

    // Setup standard output paths
    const solScreenshotDir = path.join(runDir, 'solution', 'screenshots');
    const stuScreenshotDir = path.join(runDir, 'student', 'screenshots');
    const diffScreenshotDir = path.join(runDir, 'diffs'); // New: Diff storage

    await fs.ensureDir(solScreenshotDir);
    await fs.ensureDir(stuScreenshotDir);
    await fs.ensureDir(diffScreenshotDir);

    let solServer, stuServer;

    const { performance } = require('perf_hooks');
    const startOverall = performance.now();
    const timings = {};

    try {
        // 1. Extract
        const startExtract = performance.now();
        log('Extracting ZIPs...');
        new AdmZip(solutionFile.path).extractAllTo(solExtractDir, true);
        new AdmZip(studentFile.path).extractAllTo(stuExtractDir, true);
        timings.extraction = ((performance.now() - startExtract) / 1000).toFixed(2) + 's';

        // 2. Locate Roots
        const startRoot = performance.now();
        const solRoot = await findProjectRoot(solExtractDir);
        const stuRoot = await findProjectRoot(stuExtractDir);
        timings.rootDetection = ((performance.now() - startRoot) / 1000).toFixed(2) + 's';

        // 3. Build/Serve
        const startServers = performance.now();
        log('Starting servers in parallel...');
        const port1 = 4000 + Math.floor(Math.random() * 1000);
        const port2 = 5000 + Math.floor(Math.random() * 1000);

        // Run both server setups simultaneously
        [solServer, stuServer] = await Promise.all([
            startServer(solRoot, port1),
            startServer(stuRoot, port2)
        ]);
        timings.serverStartup = ((performance.now() - startServers) / 1000).toFixed(2) + 's';

        // 4. Capture
        const startCapture = performance.now();
        const routes = ['/'];
        log('Capturing Solution Screenshots...');
        await captureScreenshots(solServer.baseUrl, routes, solScreenshotDir);

        log('Capturing Student Screenshots...');
        await captureScreenshots(stuServer.baseUrl, routes, stuScreenshotDir);
        timings.screenshotCapture = ((performance.now() - startCapture) / 1000).toFixed(2) + 's';

        // 5. Compare
        const startCompare = performance.now();
        log('Comparing...');
        const results = {};
        let totalScore = 0;
        let count = 0;

        for (const route of routes) {
            const fileName = route === '/' ? 'index.png' : `${route.replace(/\//g, '')}.png`;
            const name = route === '/' ? 'Home Page' : route.replace(/\//g, '');

            const s1 = path.join(solScreenshotDir, fileName);
            const s2 = path.join(stuScreenshotDir, fileName);
            const d = path.join(diffScreenshotDir, fileName);

            const score = compareImages(s1, s2, d);

            results[name] = {
                score: `${score}%`,
                solutionImage: `http://127.0.0.1:${PORT}/temp/${runId}/solution/screenshots/${fileName}`,
                studentImage: `http://127.0.0.1:${PORT}/temp/${runId}/student/screenshots/${fileName}`,
                diffImage: `http://127.0.0.1:${PORT}/temp/${runId}/diffs/${fileName}`
            };

            totalScore += parseFloat(score);
            count++;
        }

        timings.imageComparison = ((performance.now() - startCompare) / 1000).toFixed(2) + 's';
        timings.overall = ((performance.now() - startOverall) / 1000).toFixed(2) + 's';

        results['overall'] = `${(totalScore / count).toFixed(2)}%`;
        results['timings'] = timings;

        log(`Comparison complete. Timings: ${JSON.stringify(timings)}`);
        res.json(results);

    } catch (error) {
        log(`Error: ${error.message}`);
        console.error(error);
        // Clean up servers immediately if possible
        if (solServer?.process) spawn("taskkill", ["/pid", solServer.process.pid, '/f', '/t']);
        if (stuServer?.process) spawn("taskkill", ["/pid", stuServer.process.pid, '/f', '/t']);

        res.status(500).json({ error: error.message, stack: error.stack });
    } finally {
        // Cleanup processes just in case
        if (solServer?.process) {
            spawn("taskkill", ["/pid", solServer.process.pid, '/f', '/t']);
        }
        if (stuServer?.process) {
            spawn("taskkill", ["/pid", stuServer.process.pid, '/f', '/t']);
        }

        // Clean uploads
        await fs.remove(solutionFile.path).catch(e => console.error(e));
        await fs.remove(studentFile.path).catch(e => console.error(e));
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
