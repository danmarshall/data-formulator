// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { FC, useState } from 'react';
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

interface ChartifactDialogProps {
    open: boolean;
    onClose: () => void;
    reportContent?: string;
}

export const ChartifactDialog: FC<ChartifactDialogProps> = ({ 
    open, 
    onClose,
    reportContent = ''
}) => {
    const [source, setSource] = useState(reportContent);

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
                        placeholder="Enter the report source here..."
                        variant="outlined"
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
