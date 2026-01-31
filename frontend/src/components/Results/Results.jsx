
import './Results.css';

const Results = ({ data }) => {
    if (!data) return null;

    return (
        <div className="results-container glass-panel">
            <div className="header">
                <h2>Analysis Report</h2>
                <div className="overall-score">
                    <span className="label">Overall Match</span>
                    <span className="score">{data.overall}</span>
                </div>
            </div>

            <div className="pages-grid">
                {(!data || Object.keys(data).length <= 2) && !data.pages && (
                    <div className="no-data">No pages were compared. Check console for details.</div>
                )}
                {Object.entries(data).map(([name, info], index) => {
                    if (name === 'overall' || name === 'timings') return null;
                    return (
                        <div key={index} className="page-section">
                            <div className="page-header">
                                <span className="page-name">{name}</span>
                                <span className="page-score">{info.score}</span>
                            </div>

                            <div className="progress-bar-bg">
                                <div
                                    className="progress-bar-fill"
                                    style={{ width: info.score }}
                                ></div>
                            </div>

                            <div className="comparison-images">
                                <div className="img-box">
                                    <p>Solution</p>
                                    <img src={info.solutionImage} alt="Solution" />
                                </div>
                                <div className="img-box">
                                    <p>Student</p>
                                    <img src={info.studentImage} alt="Student" />
                                </div>
                                <div className="img-box diff">
                                    <p>Visual Diff</p>
                                    <img src={info.diffImage} alt="Difference" />
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {data.timings && (
                <div className="timings-section">
                    <h3>Performance Breakdown</h3>
                    <div className="timings-grid">
                        <div className="timing-item">
                            <span>Extraction:</span>
                            <strong>{data.timings.extraction}</strong>
                        </div>
                        <div className="timing-item">
                            <span>Root Detection:</span>
                            <strong>{data.timings.rootDetection}</strong>
                        </div>
                        <div className="timing-item">
                            <span>Server Startup:</span>
                            <strong>{data.timings.serverStartup}</strong>
                        </div>
                        <div className="timing-item">
                            <span>Capture:</span>
                            <strong>{data.timings.screenshotCapture}</strong>
                        </div>
                        <div className="timing-item">
                            <span>Comparison:</span>
                            <strong>{data.timings.imageComparison}</strong>
                        </div>
                        <div className="timing-item total">
                            <span>Total Time:</span>
                            <strong>{data.timings.overall}</strong>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Results;
