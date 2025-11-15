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
import { Chart, DictTable, FieldItem } from '../components/ComponentType';
import { assembleVegaChart, prepVisTable, exportTableToDsv } from '../app/utils';

// Chartifact library type declarations
interface SpecReview<T> {
    pluginName: string;
    containerId: string;
    approvedSpec: T;
    blockedSpec?: T;
    reason?: string;
}

interface SandboxedPreHydrateMessage {
    type: 'sandboxedPreHydrate';
    transactionId: number;
    specs: SpecReview<{}>[];
}

interface SandboxOptions {
    onReady?: () => void;
    onError?: (error: Error) => void;
    onApprove: (message: SandboxedPreHydrateMessage) => SpecReview<{}>[];
}

interface ChartifactSandbox {
    options: SandboxOptions;
    element: HTMLElement;
    iframe: HTMLIFrameElement;
    destroy(): void;
    send(markdown: string): void;
}

interface ChartifactHtmlWrapper {
    htmlMarkdownWrapper: (title: string, markdown: string) => string;
    htmlJsonWrapper: (title: string, json: string) => string;
}

const chartifactScripts = [
    'https://microsoft.github.io/chartifact/dist/v1/chartifact.sandbox.umd.js',
    'https://microsoft.github.io/chartifact/dist/v1/chartifact.html-wrapper.umd.js'
];

// Type declarations for Chartifact global
declare global {
    interface Window {
        Chartifact?: {
            sandbox: {
                Sandbox: new (
                    elementOrSelector: string | HTMLElement,
                    markdown: string,
                    options: SandboxOptions
                ) => ChartifactSandbox;
            };
            htmlWrapper: ChartifactHtmlWrapper;
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
    const sandboxRef = useRef<ChartifactSandbox | null>(null);

    // Load Chartifact scripts
    const loadChartifactScripts = async (): Promise<void> => {
        // Check if Chartifact is already loaded
        if (window.Chartifact?.sandbox && window.Chartifact?.htmlWrapper) {
            setChartifactLoaded(true);
            return;
        }

        try {
            for (const src of chartifactScripts) {
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

        try {
            sandboxRef.current = new window.Chartifact!.sandbox.Sandbox(parentElement, source, {
                onReady: () => {
                    setSandboxReady(true);
                },
                onError: (error: any) => {
                    console.error('Sandbox error:', error);
                },
                onApprove: (message: any) => {
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
        if (open && !chartifactLoaded) {
            loadChartifactScripts();
        }
    }, [open, chartifactLoaded]);

    // Initialize sandbox when dialog opens with all requirements ready
    useEffect(() => {
        if (open && chartifactLoaded && source && parentElement) {
            if (!isSandboxFunctional() || !sandboxReady) {
                initializeSandbox();
            } else if (sandboxRef.current) {
                sandboxRef.current.send(source);
            }
        }

        // Cleanup function runs when dialog closes or component unmounts
        return () => {
            if (!open && sandboxRef.current) {
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
            const chartReplacements: Array<{ original: string; specReplacement: string; dataName: string; csvContent: string }> = [];

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

                    // Create the Chartifact spec replacement (without CSV)
                    const specReplacement = `

\`\`\`json vega-lite
${JSON.stringify(modifiedSpec, null, 2)}
\`\`\`
`;

                    chartReplacements.push({
                        original: fullMatch,
                        specReplacement,
                        dataName,
                        csvContent
                    });
                } catch (error) {
                    console.error(`Error processing chart ${chartId}:`, error);
                }
            }

            // Apply spec replacements to the markdown
            for (const { original, specReplacement } of chartReplacements) {
                result = result.replace(original, specReplacement);
            }

            // Append all CSV data blocks at the bottom
            if (chartReplacements.length > 0) {
                result += '\n\n';
                for (const { dataName, csvContent } of chartReplacements) {
                    result += `\n\`\`\`csv ${dataName}\n${csvContent}\n\`\`\`\n`;
                }
            }

            return result;
        } catch (error) {
            console.error('Error converting to Chartifact:', error);
            throw error;
        }
    };

    // Convert report content when dialog opens
    useEffect(() => {
        if (open && reportContent) {
            setIsConverting(true);
            convertToChartifact(reportContent)
                .then(chartifactMarkdown => {
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
            maxWidth="xl"
            fullWidth
            PaperProps={{
                sx: {
                    minHeight: '90vh',
                    maxHeight: '90vh',
                }
            }}
        >
            <DialogTitle>
                <Typography variant="h5" component="div">
                    Chartifact Report
                </Typography>
            </DialogTitle>
            <DialogContent dividers sx={{ display: 'flex', flexDirection: 'row', gap: 2, p: 2, overflow: 'hidden' }}>
                <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1, minHeight: 0 }}>
                    <Typography variant="body2" color="text.secondary">
                        Source
                    </Typography>
                    <TextField
                        multiline
                        fullWidth
                        value={source}
                        onChange={(e) => setSource(e.target.value)}
                        placeholder={isConverting ? "Converting report to Chartifact format..." : "Enter the report source here..."}
                        variant="outlined"
                        disabled={isConverting}
                        sx={{
                            flex: 1,
                            minHeight: 0,
                            display: 'flex',
                            flexDirection: 'column',
                            '& .MuiInputBase-root': {
                                height: '100%',
                                alignItems: 'flex-start',
                                overflow: 'hidden',
                            },
                            '& .MuiInputBase-input': {
                                fontFamily: 'monospace',
                                fontSize: '0.875rem',
                                overflow: 'auto !important',
                                height: '100% !important',
                            }
                        }}
                    />
                </Box>
                <Box
                    sx={{
                        flex: 1,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 1,
                        minHeight: 0
                    }}
                >
                    <Typography variant="body2" color="text.secondary">
                        Preview
                    </Typography>
                    <Box
                        ref={setParentElement}
                        sx={{
                            flex: 1,
                            minHeight: 0,
                            border: '1px solid',
                            borderColor: 'divider',
                            borderRadius: 1,
                            overflow: 'auto',
                            position: 'relative',
                            '& > iframe': {
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                width: '100%',
                                height: '100%',
                                border: 'none',
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
