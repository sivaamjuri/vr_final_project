import { useState } from 'react';
import UploadForm from '../../components/UploadForm/UploadForm';
import Results from '../../components/Results/Results';
import './Home.css';

const Home = () => {
    const [results, setResults] = useState(null);
    const [isLoading, setIsLoading] = useState(false);

    const handleAnalyze = async (solutionFile, studentFiles) => {
        setIsLoading(true);
        setResults(null);

        const formData = new FormData();
        formData.append('solution', solutionFile);

        // Append multiple student files
        studentFiles.forEach(file => {
            formData.append('student', file);
        });

        try {
            const response = await fetch('http://127.0.0.1:3000/compare', {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.error || 'Analysis failed');
            }

            const data = await response.json();
            console.log('Batch Analysis Results:', data);
            setResults(data);
        } catch (error) {
            console.error(error);
            alert(`Error: ${error.message}`);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="home-container">
            <header className="hero">
                <h1>Visual UI Checker</h1>
                <p>Compare student submissions against the solution with pixel-perfect accuracy.</p>
            </header>

            <main className="main-content">
                {!results ? (
                    <UploadForm onAnalyze={handleAnalyze} isLoading={isLoading} />
                ) : (
                    <div className="results-wrapper">
                        <Results data={results} />
                        <button className="reset-btn" onClick={() => setResults(null)}>
                            Upload New Project
                        </button>
                    </div>
                )}
            </main>
        </div>
    );
};

export default Home;
