// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { FC, useState, useEffect } from 'react';
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
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, height: '100%' }}>
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
