import { useState } from 'react';
import JSZip from 'jszip';
import './UploadForm.css';

const UploadForm = ({ onAnalyze, isLoading }) => {
    const [solutionFile, setSolutionFile] = useState(null);
    const [studentFiles, setStudentFiles] = useState([]);
    const [error, setError] = useState('');
    const [status, setStatus] = useState('');

    const sanitizeZip = async (file, label) => {
        if (!file) return null;
        setStatus(`Optimizing ${label}...`);

        try {
            const zip = new JSZip();
            const loadedZip = await zip.loadAsync(file);
            const newZip = new JSZip();
            let count = 0;

            for (const [path, zipEntry] of Object.entries(loadedZip.files)) {
                if (!path.includes('node_modules/') &&
                    !path.includes('.git/') &&
                    !path.includes('dist/') &&
                    !zipEntry.dir) {
                    newZip.file(path, zipEntry.async('blob'));
                    count++;
                }
            }

            if (count === 0) return file;

            const content = await newZip.generateAsync({ type: 'blob' });
            return new File([content], file.name, { type: 'application/zip' });
        } catch (e) {
            console.error(`Optimization failed for ${label}, sending original.`, e);
            return file;
        }
    };

    const handleStudentFilesChange = (e) => {
        if (e.target.files.length > 0) {
            setStudentFiles(Array.from(e.target.files));
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!solutionFile || studentFiles.length === 0) {
            setError('Please select the solution and at least one student ZIP file.');
            return;
        }
        setError('');

        const cleanSolution = await sanitizeZip(solutionFile, 'Solution');
        const cleanStudents = [];

        for (let i = 0; i < studentFiles.length; i++) {
            setStatus(`Optimizing Student ${i + 1}/${studentFiles.length}...`);
            const clean = await sanitizeZip(studentFiles[i], studentFiles[i].name);
            cleanStudents.push(clean);
        }

        setStatus('Uploading bulk data...');
        onAnalyze(cleanSolution, cleanStudents);
    };

    return (
        <div className="upload-container glass-panel">
            <h2>Start Batch Comparison</h2>
            <form onSubmit={handleSubmit} className="upload-form">
                <div className="file-input-group">
                    <label>Solution Project (Reference .zip)</label>
                    <input
                        type="file"
                        accept=".zip"
                        onChange={(e) => setSolutionFile(e.target.files[0])}
                        disabled={isLoading}
                    />
                </div>
                <div className="file-input-group">
                    <label>Student Projects (Select one or more .zip)</label>
                    <input
                        type="file"
                        accept=".zip"
                        multiple
                        onChange={handleStudentFilesChange}
                        disabled={isLoading}
                    />
                    <div className="file-info">
                        {studentFiles.length > 0 && `${studentFiles.length} files selected`}
                    </div>
                </div>

                {error && <div className="error-message">{error}</div>}

                <button type="submit" className="submit-btn" disabled={isLoading}>
                    <span className="btn-content">
                        {isLoading ? (
                            <>
                                <span className="loader"></span>
                                {status || 'Processing...'}
                            </>
                        ) : (
                            'Run Bulk Visual Check'
                        )}
                    </span>
                </button>
            </form>
        </div>
    );
};

export default UploadForm;
