// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { FC, useState, useEffect, useRef } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Typography,
    TextField,
    Box,
} from '@mui/material';
import { Chart, DictTable, FieldItem, EncodingMap } from '../components/ComponentType';
import { assembleVegaChart, prepVisTable, exportTableToDsv } from '../app/utils';

// Type declarations for Chartifact
declare global {
    interface Window {
        Chartifact?: {
            sandbox: any;
            htmlWrapper: any;
        };
    }
}

interface ChartifactDialogProps {
    open: boolean;
    onClose: () => void;
    reportContent: string;
    charts: Chart[];
    tables: DictTable[];
    conceptShelfItems: FieldItem[];
    config: { defaultChartWidth: number; defaultChartHeight: number };
}

export const ChartifactDialog: FC<ChartifactDialogProps> = ({ 
    open, 
    onClose,
    reportContent,
    charts,
    tables,
    conceptShelfItems,
    config
}) => {
    const [source, setSource] = useState('');
    const [isConverting, setIsConverting] = useState(false);
    const [chartifactLoaded, setChartifactLoaded] = useState(false);
    const [sandboxReady, setSandboxReady] = useState(false);
    const [parentElement, setParentElement] = useState<HTMLDivElement | null>(null);
    const sandboxRef = useRef<any>(null);

    console.log('ChartifactDialog render:', { 
        open, 
        chartifactLoaded,
        sandboxReady,
        hasSource: !!source, 
        hasParentElement: !!parentElement,
        hasSandboxRef: !!sandboxRef.current 
    });

    // Load Chartifact scripts
    const loadChartifactScripts = async (): Promise<void> => {
        // Check if Chartifact is already loaded
        if (window.Chartifact?.sandbox && window.Chartifact?.htmlWrapper) {
            setChartifactLoaded(true);
            return;
        }

        const scripts = [
            'https://microsoft.github.io/chartifact/dist/v1/chartifact.sandbox.umd.js',
            'https://microsoft.github.io/chartifact/dist/v1/chartifact.html-wrapper.umd.js'
        ];

        try {
            for (const src of scripts) {
                await new Promise<void>((resolve, reject) => {
                    const script = document.createElement('script');
                    script.src = src;
                    script.onload = () => resolve();
                    script.onerror = () => reject(new Error(`Failed to load ${src}`));
                    document.head.appendChild(script);
                });
            }

            // Verify that Chartifact was loaded correctly
            if (window.Chartifact?.sandbox && window.Chartifact?.htmlWrapper) {
                console.log('Chartifact scripts loaded successfully');
                setChartifactLoaded(true);
            } else {
                throw new Error('Chartifact namespace not found after loading scripts');
            }
        } catch (error) {
            console.error('Error loading Chartifact scripts:', error);
            throw error;
        }
    };

    // Initialize Chartifact sandbox
    const initializeSandbox = () => {
        if (!chartifactLoaded || !parentElement || !source) {
            return;
        }

        console.log('Initializing Chartifact sandbox');
        
        try {
            sandboxRef.current = new window.Chartifact!.sandbox.Sandbox(parentElement, source, {
                onReady: () => {
                    console.log('Sandbox is ready');
                    setSandboxReady(true);
                },
                onError: (error: any) => {
                    console.error('Sandbox error:', error);
                },
                onApprove: (message: any) => {
                    console.log('Sandbox approval message:', message);
                    //TODO policy to approve unapproved on localhost
                    const { specs } = message;
                    return specs;
                },
            });
        } catch (error) {
            console.error('Error initializing Chartifact sandbox:', error);
        }
    };

    // Check if sandbox is functional
    const isSandboxFunctional = (): boolean => {
        if (!sandboxRef.current || !sandboxRef.current.iframe) {
            return false;
        }

        const iframe = sandboxRef.current.iframe;
        const contentWindow = iframe.contentWindow;

        // Only recreate if we have clear evidence of a broken iframe
        // Missing contentWindow is a clear sign of tombstoning
        if (!contentWindow) {
            return false;
        }

        // Missing or invalid src indicates a problem
        if (!iframe.src || iframe.src === 'about:blank') {
            return false;
        }

        // For normal cases (including blob URLs), assume functional to preserve user state
        // Only the clear failures above will trigger recreation
        return true;
    };    // Load scripts when dialog opens
    useEffect(() => {
        console.log('Load scripts effect triggered:', { open, chartifactLoaded });
        if (open && !chartifactLoaded) {
            console.log('Calling loadChartifactScripts');
            loadChartifactScripts();
        }
    }, [open, chartifactLoaded]);

    // Initialize sandbox when dialog opens with all requirements ready
    useEffect(() => {
        console.log('Initialize/update sandbox effect triggered:', { 
            open, 
            chartifactLoaded, 
            hasSource: !!source,
            sourceLength: source.length,
            hasParentElement: !!parentElement,
            sandboxReady
        });
        
        if (open && chartifactLoaded && source && parentElement) {
            if (!isSandboxFunctional() || !sandboxReady) {
                console.log('Creating new sandbox');
                initializeSandbox();
            } else {
                console.log('Updating existing sandbox with new source');
                sandboxRef.current.send(source);
            }
        }
        
        // Cleanup function runs when dialog closes or component unmounts
        return () => {
            if (!open && sandboxRef.current) {
                console.log('Dialog closing - destroying sandbox');
                if (sandboxRef.current.destroy) {
                    sandboxRef.current.destroy();
                }
                sandboxRef.current = null;
                setSandboxReady(false);
            }
        };
    }, [open, chartifactLoaded, source, parentElement]);


    // Function to convert report markdown to Chartifact format
    const convertToChartifact = async (reportMarkdown: string): Promise<string> => {
        try {
            // Extract chart IDs from the report markdown images
            // Images are in format: [IMAGE(chart-id)]
            const imageRegex = /\[IMAGE\(([^)]+)\)\]/g;
            let result = reportMarkdown;
            let match;
            const replacements: Array<{ original: string; replacement: string }> = [];

            while ((match = imageRegex.exec(reportMarkdown)) !== null) {
                const [fullMatch, chartId] = match;
                
                // Find the chart in the store using the chart ID
                const chart = charts.find(c => c.id === chartId);
                if (!chart) {
                    console.warn(`Chart with id ${chartId} not found in store`);
                    continue;
                }

                // Get the chart's data table from the store using chart.tableRef
                const chartTable = tables.find(t => t.id === chart.tableRef);
                if (!chartTable) {
                    console.warn(`Table for chart ${chartId} not found`);
                    continue;
                }

                // Skip non-visual chart types
                if (chart.chartType === 'Table' || chart.chartType === '?') {
                    continue;
                }

                try {
                    // Preprocess the data for aggregations
                    const processedRows = prepVisTable(chartTable.rows, conceptShelfItems, chart.encodingMap);
                    
                    // Assemble the Vega-Lite spec
                    const vegaSpec = assembleVegaChart(
                        chart.chartType,
                        chart.encodingMap,
                        conceptShelfItems,
                        processedRows,
                        chartTable.metadata,
                        30,
                        true,
                        config.defaultChartWidth,
                        config.defaultChartHeight,
                        true
                    );

                    // Convert the spec to use named data source
                    const dataName = `chartData_${chartId.replace(/[^a-zA-Z0-9]/g, '_')}`;
                    const modifiedSpec = {
                        ...vegaSpec,
                        data: { name: dataName }
                    };

                    // Convert table rows to CSV format using the utility function
                    const csvContent = exportTableToDsv(chartTable, ',');

                    // Create the Chartifact format replacement
                    const chartifactReplacement = `

\`\`\`json vega-lite
${JSON.stringify(modifiedSpec, null, 2)}
\`\`\`

\`\`\`csv ${dataName}
${csvContent}
\`\`\`
`;

                    replacements.push({
                        original: fullMatch,
                        replacement: chartifactReplacement
                    });
                } catch (error) {
                    console.error(`Error processing chart ${chartId}:`, error);
                }
            }

            // Apply all replacements
            for (const { original, replacement } of replacements) {
                result = result.replace(original, replacement);
            }

            return result;
        } catch (error) {
            console.error('Error converting to Chartifact:', error);
            throw error;
        }
    };

    // Convert report content when dialog opens
    useEffect(() => {
        console.log('Convert report effect triggered:', { open, hasReportContent: !!reportContent });
        if (open && reportContent) {
            console.log('Starting conversion');
            setIsConverting(true);
            convertToChartifact(reportContent)
                .then(chartifactMarkdown => {
                    console.log('Conversion complete, setting source');
                    setSource(chartifactMarkdown);
                    setIsConverting(false);
                })
                .catch(error => {
                    console.error('Error converting to Chartifact:', error);
                    setSource('Error converting report to Chartifact format');
                    setIsConverting(false);
                });
        }
    }, [open, reportContent]);

    return (
        <Dialog
            open={open}
            onClose={onClose}
            maxWidth="lg"
            fullWidth
            PaperProps={{
                sx: {
                    minHeight: '80vh',
                    maxHeight: '90vh',
                }
            }}
        >
            <DialogTitle>
                <Typography variant="h5" component="div">
                    Chartifact Report
                </Typography>
            </DialogTitle>
            <DialogContent dividers>
                <Box 
                    ref={setParentElement}
                    sx={{ display: 'flex', flexDirection: 'column', gap: 2, height: '100%' }}
                >
                    <Typography variant="body1" color="text.secondary">
                        Report Source
                    </Typography>
                    <TextField
                        multiline
                        fullWidth
                        minRows={20}
                        maxRows={20}
                        value={source}
                        onChange={(e) => setSource(e.target.value)}
                        placeholder={isConverting ? "Converting report to Chartifact format..." : "Enter the report source here..."}
                        variant="outlined"
                        disabled={isConverting}
                        sx={{
                            flex: 1,
                            '& .MuiInputBase-root': {
                                height: '100%',
                                alignItems: 'flex-start',
                            },
                            '& .MuiInputBase-input': {
                                fontFamily: 'monospace',
                                fontSize: '0.875rem',
                            }
                        }}
                    />
                </Box>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} color="primary">
                    Close
                </Button>
            </DialogActions>
        </Dialog>
    );
};
