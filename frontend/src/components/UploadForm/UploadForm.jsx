import { useState } from 'react';
import JSZip from 'jszip';
import './UploadForm.css';

const UploadForm = ({ onAnalyze, isLoading }) => {
    const [solutionFile, setSolutionFile] = useState(null);
    const [studentFile, setStudentFile] = useState(null);
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
                // Filter out large/unnecessary folders
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

    const handleFileChange = (setter) => (e) => {
        if (e.target.files[0]) {
            setter(e.target.files[0]);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!solutionFile || !studentFile) {
            setError('Please select both ZIP files.');
            return;
        }
        setError('');

        const cleanSolution = await sanitizeZip(solutionFile, 'Solution');
        const cleanStudent = await sanitizeZip(studentFile, 'Student');

        setStatus('Uploading to server...');
        onAnalyze(cleanSolution, cleanStudent);
    };

    return (
        <div className="upload-container glass-panel">
            <h2>Start Comparison</h2>
            <form onSubmit={handleSubmit} className="upload-form">
                <div className="file-input-group">
                    <label>Solution Project (.zip)</label>
                    <input
                        type="file"
                        accept=".zip"
                        onChange={handleFileChange(setSolutionFile)}
                        disabled={isLoading}
                    />
                </div>
                <div className="file-input-group">
                    <label>Student Project (.zip)</label>
                    <input
                        type="file"
                        accept=".zip"
                        onChange={handleFileChange(setStudentFile)}
                        disabled={isLoading}
                    />
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
                            'Run Visual Check'
                        )}
                    </span>
                </button>
            </form>
        </div>
    );
};

export default UploadForm;
