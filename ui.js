
import { parseWorkoutXML } from './parser.js';
import { calculateTSS, formatDuration } from './workout.js';
import { generateERGContent, generateMRCContent, downloadFile, generateZWOContent } from './exporter.js';
import { fetchDirectory, fetchWorkoutFile, deployWorkout, sendChatMessage, getZwiftWorkoutDirectory, saveAsWorkout, selectFolder } from './api.js';
import { WorkoutGenerator } from './workout-generator.js';
import { powerZoneManager } from './power-zones.js';

/**
 * UI Manager Class
 * Handles all user interface interactions and updates for the workout visualizer
 * 
 * @class UI
 * @description Manages UI components, event handling, and user interactions
 */
export class UI {
    constructor(visualizer) {
        if (!visualizer) {
            throw new Error('UI: Visualizer instance is required');
        }
        
        this.visualizer = visualizer;
        this.chart = null;
        this.workoutGenerator = new WorkoutGenerator(powerZoneManager);
        
        // Cache frequently accessed DOM elements
        this._domCache = new Map();
        
        // Initialize UI components
        this._initializeComponents();
    }

    /**
     * Initialize all UI components and event listeners
     * @private
     */
    _initializeComponents() {
        try {
            this.initializeEventListeners();
            this.setupUndoButton();
            this.renderDirectoryTree();
            this.setupPanelToggles();
            this.setupSegmentToggle();
            this.setupChatInterface();
        } catch (error) {
            console.error('UI: Failed to initialize components:', error);
            this.showToast('Failed to initialize UI components. Some features may not work properly.');
        }
    }

    /**
     * Initialize event listeners with error handling
     */
    initializeEventListeners() {
        const eventMappings = [
            { id: 'fileInput', event: 'change', handler: (e) => this.visualizer.handleFileUpload(e) },
            { id: 'loadSample', event: 'click', handler: () => this.visualizer.loadSampleWorkout() },
            { id: 'exportERG', event: 'click', handler: () => this.visualizer.exportToERG() },
            { id: 'exportMRC', event: 'click', handler: () => this.visualizer.exportToMRC() },
            { id: 'ftpInput', event: 'input', handler: (e) => this._handleFTPInput(e) },
            { id: 'scaleSlider', event: 'input', handler: (e) => this.updateScaleValue(e.target.value) },
            { id: 'applyScale', event: 'click', handler: () => this.visualizer.applyScaling() },
            { id: 'resetWorkout', event: 'click', handler: () => this.visualizer.resetWorkout() },
            { id: 'exportModified', event: 'click', handler: () => this.visualizer.exportModifiedZWO() },
            { id: 'deployWorkout', event: 'click', handler: () => this.visualizer.deployWorkout() },
            { id: 'saveAsWorkout', event: 'click', handler: () => this.showSaveAsDialog() }
        ];

        eventMappings.forEach(({ id, event, handler }) => {
            this._addEventListenerSafely(id, event, handler);
        });
    }

    /**
     * Safely add event listener with error handling
     * @private
     * @param {string} elementId - DOM element ID
     * @param {string} event - Event type
     * @param {Function} handler - Event handler function
     */
    _addEventListenerSafely(elementId, event, handler) {
        const element = this._getElement(elementId);
        if (element) {
            try {
                element.addEventListener(event, handler);
            } catch (error) {
                console.error(`UI: Failed to add ${event} listener to ${elementId}:`, error);
            }
        } else {
            console.warn(`UI: Element ${elementId} not found, skipping event listener`);
        }
    }

    /**
     * Get DOM element with caching
     * @private
     * @param {string} elementId - Element ID
     * @returns {HTMLElement|null} DOM element or null if not found
     */
    _getElement(elementId) {
        if (!this._domCache.has(elementId)) {
            const element = document.getElementById(elementId);
            this._domCache.set(elementId, element);
        }
        return this._domCache.get(elementId);
    }

    /**
     * Handle FTP input with validation
     * @private
     * @param {Event} e - Input event
     */
    _handleFTPInput(e) {
        const value = parseInt(e.target.value);
        const ftp = isNaN(value) || value <= 0 ? 250 : Math.min(value, 1000); // Cap at reasonable max
        
        if (ftp !== value) {
            e.target.value = ftp;
        }
        
        this.visualizer.updateFTP(ftp);
    }

    setupUndoButton() {
        const undoBtn = document.getElementById('undoEditBtn');
        if (!undoBtn) return;
        undoBtn.onclick = () => {
            this.visualizer.undoLastEdit();
        };
        this.updateUndoButton(0);
    }

    /**
     * Update undo button visibility and state
     * @param {number} stackLength - Length of undo stack
     */
    updateUndoButton(stackLength) {
        const undoBtn = this._getElement('undoEditBtn');
        if (!undoBtn) {
            console.warn('UI: Undo button not found');
            return;
        }
        
        const hasUndoActions = stackLength > 0;
        undoBtn.style.display = hasUndoActions ? 'block' : 'none';
        undoBtn.disabled = !hasUndoActions;
        undoBtn.title = hasUndoActions ? `Undo last edit (${stackLength} actions available)` : 'No actions to undo';
    }

    /**
     * Show toast notification with improved error handling
     * @param {string} msg - Message to display
     * @param {string} type - Toast type ('info', 'success', 'warning', 'error')
     * @param {number} duration - Duration in milliseconds (default: 3000)
     */
    showToast(msg, type = 'info', duration = 3000) {
        if (!msg || typeof msg !== 'string') {
            console.warn('UI: Invalid toast message:', msg);
            return;
        }

        try {
            let toast = this._getElement('toastNotification');
            if (!toast) {
                toast = this._createToastElement();
                this._domCache.set('toastNotification', toast);
            }
            
            // Clear previous classes and add new type
            toast.className = `toast-notification toast-${type}`;
            toast.textContent = msg;
            toast.classList.add('show');
            
            // Clear any existing timeout
            if (toast._hideTimeout) {
                clearTimeout(toast._hideTimeout);
            }
            
            // Set new timeout
            toast._hideTimeout = setTimeout(() => {
                toast.classList.remove('show');
                toast._hideTimeout = null;
            }, duration);
        } catch (error) {
            console.error('UI: Failed to show toast:', error);
            // Fallback to alert if toast fails
            if (type === 'error') {
                alert(`Error: ${msg}`);
            }
        }
    }

    /**
     * Create toast notification element
     * @private
     * @returns {HTMLElement} Toast element
     */
    _createToastElement() {
        const toast = document.createElement('div');
        toast.id = 'toastNotification';
        toast.className = 'toast-notification';
        document.body.appendChild(toast);
        return toast;
    }

    displayWorkoutInfo(workoutData, tss) {
        document.getElementById('workoutName').textContent = workoutData.name;
        document.getElementById('workoutDescription').textContent = workoutData.description;
        document.getElementById('workoutAuthor').textContent = workoutData.author;
        document.getElementById('workoutSport').textContent = workoutData.sportType;
        document.getElementById('totalDuration').textContent = formatDuration(workoutData.totalDuration);
        document.getElementById('workoutTSS').textContent = tss;
        
        document.getElementById('workoutInfo').style.display = 'block';
    }

    createPowerZoneAnnotations(ftp) {
        const powerZones = {
            'Zone 1 (Active Recovery)': { min: 0, max: 55, color: '#808080' },
            'Zone 2 (Endurance)': { min: 56, max: 75, color: '#0000FF' },
            'Zone 3 (Tempo)': { min: 76, max: 90, color: '#008000' },
            'Zone 4 (Lactate Threshold)': { min: 91, max: 105, color: '#FFFF00' },
            'Zone 5 (VO2 Max)': { min: 106, max: 120, color: '#FFA500' },
            'Zone 6 (Anaerobic Capacity)': { min: 121, max: 150, color: '#FF0000' },
            'Zone 7 (Neuromuscular Power)': { min: 151, max: 999, color: '#800080' },
        };

        const annotations = {};

        for (const zone in powerZones) {
            const { min, max, color } = powerZones[zone];
            annotations[zone] = {
                type: 'box',
                yMin: min,
                yMax: max,
                backgroundColor: color + '33',
                borderColor: color + '33',
                borderWidth: 1,
                label: {
                    content: zone,
                    enabled: true,
                    position: 'start',
                    color: '#000',
                    font: {
                        size: 10,
                    },
                },
            };
        }

        return annotations;
    }

    createChart(workoutData, ftp, selectedSegmentIndex, onSegmentClick) {
        const ctx = document.getElementById('workoutChart').getContext('2d');
        
        if (this.chart) {
            this.chart.destroy();
        }

        const colors = {
            'Warmup': '#FFA726',
            'Cooldown': '#66BB6A',
            'SteadyState': '#42A5F5',
            'Interval (On)': '#EF5350',
            'Interval (Off)': '#AB47BC',
            'Ramp': '#FF7043',
            'FreeRide': '#78909C'
        };

        const allSegments = this.visualizer.workout.getAllSegments();
        allSegments.sort((a, b) => a.startTime - b.startTime);

        // Create a single continuous dataset for the entire workout
        const continuousWorkoutData = [];
        
        allSegments.forEach(segment => {
            segment.powerData.forEach((point, index) => {
                continuousWorkoutData.push({
                    x: point.x,
                    y: point.y,
                    segmentType: segment.type,
                    segmentIndex: allSegments.indexOf(segment)
                });
            });
        });
        
        // Sort by time to ensure continuity
        continuousWorkoutData.sort((a, b) => a.x - b.x);

        // Create the main workout profile dataset
        const datasets = [{
            label: 'Workout Profile',
            data: continuousWorkoutData,
            borderColor: '#2563eb', // Primary blue color
            backgroundColor: 'rgba(37, 99, 235, 0.1)', // Light blue fill
            borderWidth: 2,
            fill: 'origin', // Fill to zero baseline
            tension: 0.1,
            pointRadius: 0,
            pointHoverRadius: 4,
            pointBackgroundColor: (context) => {
                // Color points based on segment type
                const point = context.parsed || context.dataPoint;
                if (point && continuousWorkoutData[context.dataIndex]) {
                    const segmentType = continuousWorkoutData[context.dataIndex].segmentType;
                    return colors[segmentType] || '#999';
                }
                return '#2563eb';
            },
            segment: {
                borderColor: (context) => {
                    // Color line segments based on workout segment type
                    const point = context.p1DataIndex;
                    if (point !== undefined && continuousWorkoutData[point]) {
                        const segmentType = continuousWorkoutData[point].segmentType;
                        return colors[segmentType] || '#2563eb';
                    }
                    return '#2563eb';
                }
            }
        }];

        if (selectedSegmentIndex !== null && allSegments[selectedSegmentIndex]) {
            const seg = allSegments[selectedSegmentIndex];
            datasets.push({
                label: 'Selected',
                data: seg.powerData,
                borderColor: '#FFD600',
                backgroundColor: '#FFD60040',
                borderWidth: 3,
                fill: true,
                tension: 0.1,
                pointRadius: 0,
                pointHoverRadius: 6,
                order: 100
            });
            this.showSegmentEditForm(selectedSegmentIndex, seg);
        } else {
            const editBox = document.getElementById('segmentEditBox');
            if (editBox) editBox.style.display = 'none';
        }

        const hoverPowerBox = document.getElementById('hoverPowerBox');
        if (hoverPowerBox) hoverPowerBox.style.display = 'none';

        const annotations = this.createPowerZoneAnnotations(ftp);

        this.chart = new Chart(ctx, {
            type: 'line',
            data: { datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    intersect: false,
                    mode: 'index'
                },
                plugins: {
                    title: {
                        display: true,
                        text: 'Workout Power Profile',
                        font: { size: 16, weight: 'bold' }
                    },
                    legend: {
                        display: true,
                        position: 'top',
                        labels: {
                            generateLabels: (chart) => {
                                // Create custom legend showing segment types
                                const segmentTypes = [...new Set(continuousWorkoutData.map(point => point.segmentType))];
                                return segmentTypes.map(type => ({
                                    text: type,
                                    fillStyle: colors[type] || '#999',
                                    strokeStyle: colors[type] || '#999',
                                    lineWidth: 2,
                                    hidden: false
                                }));
                            }
                        }
                    },
                    tooltip: {
                        enabled: true,
                        callbacks: {
                            title: function(context) {
                                const time = context[0].parsed.x;
                                return `Time: ${Math.floor(time / 60)}:${(time % 60).toString().padStart(2, '0')}`;
                            },
                            label: (context) => {
                                const percent = context.parsed.y;
                                const actual = Math.round((percent / 100) * ftp);
                                const dataIndex = context.dataIndex;
                                const segmentType = continuousWorkoutData[dataIndex]?.segmentType || 'Unknown';
                                return `${segmentType}: ${percent.toFixed(1)}% FTP (${actual} W)`;
                            }
                        },
                        external: (context) => {
                            const tooltip = context.tooltip;
                            if (!hoverPowerBox) return;
                            if (tooltip && tooltip.opacity > 0 && tooltip.dataPoints && tooltip.dataPoints.length > 0) {
                                const dp = tooltip.dataPoints[0];
                                const percent = dp.parsed.y;
                                const actual = Math.round((percent / 100) * ftp);
                                hoverPowerBox.innerHTML = `<span>Hovered Power: <b>${percent.toFixed(1)}% FTP</b> = <b>${actual} W</b> (FTP: ${ftp} W)</span>`;
                                hoverPowerBox.style.display = 'block';
                            } else {
                                hoverPowerBox.style.display = 'none';
                            }
                        }
                    },
                    annotation: {
                        annotations: annotations,
                    },
                },
                onClick: (event, elements, chart) => {
                    const points = chart.getElementsAtEventForMode(event, 'nearest', { intersect: false }, true);
                    if (points && points.length > 0) {
                        const point = points[0];
                        const dataIndex = point.index;
                        
                        // Get segment index from the clicked data point
                        if (dataIndex !== undefined && continuousWorkoutData[dataIndex]) {
                            const segmentIndex = continuousWorkoutData[dataIndex].segmentIndex;
                            onSegmentClick(segmentIndex);
                        }
                    } else {
                        onSegmentClick(null);
                    }
                },
                scales: {
                    x: {
                        type: 'linear',
                        position: 'bottom',
                        title: {
                            display: true,
                            text: 'Time (seconds)'
                        },
                        ticks: {
                            callback: function(value) {
                                const minutes = Math.floor(value / 60);
                                const seconds = value % 60;
                                return `${minutes}:${seconds.toString().padStart(2, '0')}`;
                            }
                        }
                    },
                    y: {
                        title: {
                            display: true,
                            text: 'Power (% FTP)'
                        },
                        min: 0,
                        max: Math.max(120, Math.max(...continuousWorkoutData.map(p => p.y)) + 10),
                        grid: {
                            color: 'rgba(0, 0, 0, 0.1)',
                            lineWidth: 1
                        }
                    }
                }
            }
        });

        document.querySelector('.chart-container').style.display = 'block';
    }

    displaySegmentDetails(workoutData) {
        const segmentList = document.getElementById('segmentList');
        segmentList.innerHTML = '';

        const allSegments = this.visualizer.workout.getAllSegments();

        allSegments.forEach((segment, index) => {
            const segmentDiv = document.createElement('div');
            segmentDiv.className = 'segment segment-item';
            
            let powerText = '';
            if (segment.power !== undefined) {
                powerText = `${(segment.power * 100).toFixed(1)}% FTP`;
            } else if (segment.powerLow !== undefined && segment.powerHigh !== undefined) {
                powerText = `${(segment.powerLow * 100).toFixed(1)}% - ${(segment.powerHigh * 100).toFixed(1)}% FTP`;
            }

            segmentDiv.innerHTML = `
                <div class="segment-header">
                    <span class="segment-type">${segment.type}</span>
                    <span class="segment-duration">${formatDuration(segment.duration)}</span>
                </div>
                <div class="segment-power">Power: ${powerText}</div>
            `;
            
            segmentList.appendChild(segmentDiv);
        });

        document.getElementById('segmentDetails').style.display = 'block';
    }

    updateScaleValue(value) {
        document.querySelector('.scale-value').textContent = parseFloat(value).toFixed(1);
    }

    showSegmentEditForm(segmentIndex, segment) {
        const editBox = document.getElementById('segmentEditBox');
        if (!editBox) return;
        let html = '<form id="segmentEditForm">';
        html += `<div><b>Edit Segment:</b> <span>${segment.type}</span></div><br/>`;
        html += `<div><label for="segEditDuration">Duration (sec):</label><input type="number" id="segEditDuration" value="${segment.duration}" min="1" max="7200" required></div>`;
        if (segment.type === 'SteadyState' || segment.type === 'Interval (On)' || segment.type === 'Interval (Off)' || segment.type === 'FreeRide') {
            html += `<div><label for="segEditPower">Power (% FTP):</label><input type="number" id="segEditPower" value="${(segment.power * 100).toFixed(0)}" min="1" max="300" required></div>`;
        } else if (segment.type === 'Warmup' || segment.type === 'Cooldown' || segment.type === 'Ramp') {
            html += `<div><label for="segEditPowerLow">Power Low (% FTP):</label><input type="number" id="segEditPowerLow" value="${(segment.powerLow * 100).toFixed(0)}" min="1" max="300" required></div>`;
            html += `<div><label for="segEditPowerHigh">Power High (% FTP):</label><input type="number" id="segEditPowerHigh" value="${(segment.powerHigh * 100).toFixed(0)}" min="1" max="300" required></div>`;
        }
        html += '<div id="segEditError" style="color:#c62828;font-weight:600;margin:8px 0 0 0;display:none;"></div>';
        html += `<div class="edit-btns">
            <button type="submit" class="apply-btn">Apply</button>
            <button type="button" class="cancel-btn" id="segEditCancel">Cancel</button>
        </div>`;
        html += '</form>';
        editBox.innerHTML = html;
        editBox.style.display = 'block';

        const form = document.getElementById('segmentEditForm');
        const cancelBtn = document.getElementById('segEditCancel');
        const errorDiv = document.getElementById('segEditError');
        
        let lastFocusedInput = null;
        const inputs = ['segEditDuration', 'segEditPower', 'segEditPowerLow', 'segEditPowerHigh'];
        inputs.forEach(inputId => {
            const input = document.getElementById(inputId);
            if (input) {
                input.addEventListener('focus', () => {
                    lastFocusedInput = inputId;
                });
            }
        });

        form.onsubmit = (e) => {
            e.preventDefault();
            errorDiv.style.display = 'none';
            const newDuration = parseInt(document.getElementById('segEditDuration').value);
            if (isNaN(newDuration) || newDuration < 1 || newDuration > 7200) {
                errorDiv.textContent = 'Duration must be between 1 and 7200 seconds.';
                errorDiv.style.display = 'block';
                return;
            }
            
            let newPower, newPowerLow, newPowerHigh;

            if (segment.type === 'SteadyState' || segment.type === 'Interval (On)' || segment.type === 'Interval (Off)' || segment.type === 'FreeRide') {
                newPower = parseInt(document.getElementById('segEditPower').value);
                if (isNaN(newPower) || newPower < 1 || newPower > 300) {
                    errorDiv.textContent = 'Power must be between 1 and 300% FTP.';
                    errorDiv.style.display = 'block';
                    return;
                }
            } else if (segment.type === 'Warmup' || segment.type === 'Cooldown' || segment.type === 'Ramp') {
                newPowerLow = parseInt(document.getElementById('segEditPowerLow').value);
                newPowerHigh = parseInt(document.getElementById('segEditPowerHigh').value);
                if (isNaN(newPowerLow) || isNaN(newPowerHigh) || newPowerLow < 1 || newPowerLow > 300 || newPowerHigh < 1 || newPowerHigh > 300) {
                    errorDiv.textContent = 'Power values must be between 1 and 300% FTP.';
                    errorDiv.style.display = 'block';
                    return;
                }
                if (newPowerLow > newPowerHigh) {
                    errorDiv.textContent = 'Power Low must be less than or equal to Power High.';
                    errorDiv.style.display = 'block';
                    return;
                }
            }
            this.visualizer.applySegmentEdit(segmentIndex, newDuration, newPower, newPowerLow, newPowerHigh);
            
            setTimeout(() => {
                if (lastFocusedInput) {
                    const input = document.getElementById(lastFocusedInput);
                    if (input) {
                        input.focus();
                        input.select();
                    }
                }
            }, 100);
        };
        cancelBtn.onclick = (e) => {
            this.visualizer.setSelectedSegmentIndex(null);
            editBox.style.display = 'none';
            this.visualizer.createChart();
        };
    }

    async renderDirectoryTree() {
        const tree = document.getElementById('directoryTree');
        if (!tree) return; // Ensure the element exists
        tree.innerHTML = '';
        const items = await fetchDirectory();
        items.forEach(item => {
            tree.appendChild(this.createDirectoryItem(item));
        });
    }

    createDirectoryItem(item, parentPath = '') {
        const div = document.createElement('div');
        div.className = 'directory-item' + (item.is_dir ? ' folder' : ' file');
        div.textContent = item.name;
        div.dataset.path = item.path;
        if (item.is_dir) {
            div.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (div.classList.contains('expanded')) {
                    div.classList.remove('expanded');
                    const children = div.querySelectorAll(':scope > .directory-children');
                    children.forEach(child => child.remove());
                } else {
                    div.classList.add('expanded');
                    if (!div.querySelector('.directory-children')) {
                        const childrenDiv = document.createElement('div');
                        childrenDiv.className = 'directory-children';
                        const children = await fetchDirectory(item.path);
                        children.forEach(child => {
                            childrenDiv.appendChild(this.createDirectoryItem(child, item.path));
                        });
                        div.appendChild(childrenDiv);
                    }
                }
            });
        } else if (item.name.toLowerCase().endsWith('.zwo')) {
            div.addEventListener('click', async (e) => {
                e.stopPropagation();
                document.querySelectorAll('.directory-item.selected').forEach(el => el.classList.remove('selected'));
                div.classList.add('selected');
                try {
                    const content = await fetchWorkoutFile(item.path);
                    this.visualizer.parseAndVisualize(content);
                } catch (error) {
                    console.error('Error loading workout from directory:', error);
                    this.showToast('Error loading workout.');
                }
            });
        }
        return div;
    }

    setupPanelToggles() {
        const dirPanel = document.getElementById('directoryPanel');
        const dirToggle = document.getElementById('toggleDirectoryPanel');
        if (dirToggle) {
            dirToggle.addEventListener('click', (e) => {
                e.stopPropagation();
                dirPanel.classList.toggle('minimized');
                dirToggle.textContent = dirPanel.classList.contains('minimized') ? '>' : '<';
                dirToggle.title = dirPanel.classList.contains('minimized') ? 'Restore' : 'Minimize';
            });
        }

        const chatPanel = document.getElementById('chatPanel');
        const chatToggle = document.getElementById('toggleChatPanel');
        const container = document.querySelector('.container');
        
        if (chatToggle && chatPanel && container) {
            chatToggle.addEventListener('click', (e) => {
                e.stopPropagation();
                chatPanel.classList.toggle('minimized');
                chatToggle.textContent = chatPanel.classList.contains('minimized') ? '<' : '>';
                chatToggle.title = chatPanel.classList.contains('minimized') ? 'Restore' : 'Minimize';
                
                // Adjust main content margin
                if (chatPanel.classList.contains('minimized')) {
                    container.style.paddingRight = '3rem';
                } else {
                    container.style.paddingRight = '20rem';
                }
            });
        }
    }

    setupSegmentToggle() {
        const segmentDetails = document.getElementById('segmentDetails');
        const toggleSegments = document.getElementById('toggleSegments');
        if (toggleSegments && segmentDetails) {
            toggleSegments.addEventListener('click', (e) => {
                e.stopPropagation();
                segmentDetails.classList.toggle('collapsed');
                toggleSegments.textContent = segmentDetails.classList.contains('collapsed') ? '+' : '−';
                toggleSegments.title = segmentDetails.classList.contains('collapsed') ? 'Expand' : 'Collapse';
            });
        }
    }

    setupChatInterface() {
        const chatForm = document.getElementById('chatForm');
        const llmToggle = document.getElementById('llmModeToggle');
        
        // Handle LLM mode toggle persistence
        if (llmToggle) {
            // Load saved preference
            llmToggle.checked = localStorage.getItem('useLLM') === 'true';
            
            // Save preference on change
            llmToggle.addEventListener('change', () => {
                localStorage.setItem('useLLM', llmToggle.checked);
            });
        }
        
        if (chatForm) {
            chatForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const input = document.getElementById('chatInput');
                const message = input.value.trim();
                if (!message) return;
                
                this.appendChatMessage(message, 'user');
                input.value = '';
                
                // Show thinking message
                const thinkingMsg = this.appendChatMessage('🤔 Creating your workout...', 'llm thinking');
                
                // Check if LLM mode is enabled
                const llmToggle = document.getElementById('llmModeToggle');
                const useLLM = llmToggle && llmToggle.checked;
                
                if (useLLM) {
                    // Use LLM generation
                    this.generateWorkoutWithLLM(message);
                } else {
                    // Generate workout locally
                    setTimeout(() => {
                        try {
                            const workoutData = this.workoutGenerator.generateWorkout(message);
                            this.removeLastChatMessage(); // Remove thinking message
                        
                            // Debug: Log workout structure
                            console.log('Generated workout data:', workoutData);
                        
                            // Generate XML for debugging
                            const xmlContent = generateZWOContent(workoutData);
                            console.log('Generated XML:', xmlContent);
                        
                            // Create workout from generated data
                            this.visualizer.createWorkoutFromData(workoutData);
                        
                            // Show success message with debug option
                            const duration = Math.round(workoutData.totalDuration / 60);
                            const successMsg = `✅ Created "${workoutData.name}" - ${duration} minutes, TSS: ${workoutData.tss}`;
                            this.appendChatMessage(successMsg, 'llm');
                        
                            // Add debug button
                            this.addDebugXMLButton(xmlContent, workoutData);
                        
                        } catch (error) {
                            this.removeLastChatMessage();
                            console.error('Error generating workout:', error);
                            
                            // Provide detailed error information
                            let errorMessage = '❌ Workout creation failed: ';
                            if (error.message.includes('complexIntervals')) {
                                errorMessage += 'Complex interval parsing error. Check your interval format (e.g., "2 x 14\' (4\') as first 2\' @ 105% then 12\' at 100%").';
                            } else if (error.message.includes('duration')) {
                                errorMessage += 'Duration parsing error. Use formats like "45 minutes", "1 hour", or "90 min".';
                            } else if (error.message.includes('power')) {
                                errorMessage += 'Power calculation error. Check percentage values are realistic (50-300%).';
                            } else if (error.name === 'TypeError') {
                                errorMessage += `Missing required data: ${error.message}. Try a simpler workout description.`;
                            } else {
                                errorMessage += `${error.message}. Try: "Create a 45-minute endurance ride" or "4x5 minute threshold intervals".`;
                            }
                            
                            this.appendChatMessage(errorMessage, 'llm');
                            
                            // Add debug information
                            this.appendChatMessage('🔍 Debug: Check browser console (F12) for detailed error information.', 'llm debug');
                        }
                    }, 500); // Small delay to show thinking state
                }
            });
        }
    }

    async generateWorkoutWithLLM(message) {
        try {
            // Load instructions and create enhanced prompt
            const response = await fetch('WORKOUT_CREATION_INSTRUCTIONS.md');
            const instructions = await response.text();
            
            const enhancedPrompt = `${instructions}
            
Please create a workout based on this request: "${message}"

IMPORTANT: Return ONLY a valid JSON object that follows the exact structure shown in the instructions. Do not include any other text, explanations, or markdown formatting. The response should start with { and end with }.

The JSON should have this exact structure:
{
    "name": "workout name",
    "description": "description", 
    "author": "Workout Creator",
    "sportType": "bike",
    "totalDuration": duration_in_seconds,
    "segments": [array of segment objects],
    "tss": calculated_tss_value
}`;

            const llmResponse = await sendChatMessage(enhancedPrompt);
            this.removeLastChatMessage(); // Remove thinking message
            
            // Try to parse the LLM response as JSON
            let workoutData;
            try {
                // Extract JSON from response (in case LLM adds extra text)
                const jsonMatch = llmResponse.match(/\{[\s\S]*\}/);
                const jsonStr = jsonMatch ? jsonMatch[0] : llmResponse;
                workoutData = JSON.parse(jsonStr);
            } catch (parseError) {
                console.error('LLM returned invalid JSON:', llmResponse);
                throw new Error('LLM returned invalid JSON format');
            }
            
            // Debug: Log workout structure
            console.log('LLM Generated workout data:', workoutData);
            
            // Generate XML for debugging
            const xmlContent = generateZWOContent(workoutData);
            console.log('LLM Generated XML:', xmlContent);
            
            // Create workout from generated data
            this.visualizer.createWorkoutFromData(workoutData);
            
            // Show success message with debug option
            const duration = Math.round(workoutData.totalDuration / 60);
            const successMsg = `✅ Created "${workoutData.name}" (LLM) - ${duration} minutes, TSS: ${workoutData.tss}`;
            this.appendChatMessage(successMsg, 'llm');
            
            // Add debug button
            this.addDebugXMLButton(xmlContent, workoutData);
            
        } catch (error) {
            this.removeLastChatMessage();
            console.error('Error with LLM generation:', error);
            
            // Check if we have a detailed server-side error message
            let errorMessage = '❌ **LLM Generation Failed**\n\n';
            
            if (error.serverResponse && error.serverResponse.reply) {
                // Use the detailed diagnostic message from the server
                errorMessage = error.serverResponse.reply;
            } else if (error.message) {
                // Categorize client-side errors with enhanced diagnostics
                if (error.message.includes('fetch') || error.message.includes('Failed to fetch')) {
                    errorMessage += "**Connection Error**\n\nCannot connect to the LLM server.\n\n**Troubleshooting Steps:**\n1. Check if server is running: `python3 server.py`\n2. Verify server is accessible at http://localhost:53218\n3. Check for firewall or network issues\n4. Try using Local mode instead\n\n**Alternative:** Disable 'Use LLM' toggle for local generation";
                } else if (error.message.includes('timeout')) {
                    errorMessage += "**Timeout Error**\n\nThe LLM request took too long to complete.\n\n**Troubleshooting Steps:**\n1. Try a simpler workout description\n2. Check your internet connection\n3. Wait a moment and try again\n4. Use Local mode for faster generation\n\n**Technical Details:** Request timeout after waiting for server response";
                } else if (error.message.includes('JSON') || error.message.includes('parse')) {
                    errorMessage += "**Response Format Error**\n\nThe LLM returned an invalid response format.\n\n**Troubleshooting Steps:**\n1. Try a different workout description\n2. Check the debug output for malformed data\n3. Restart the server to reset the LLM state\n4. Use Local mode as an alternative\n\n**Technical Details:** " + error.message;
                } else {
                    errorMessage += "**Unexpected Error**\n\nAn unexpected error occurred during LLM communication.\n\n**Troubleshooting Steps:**\n1. Check the browser console (F12) for technical details\n2. Verify the server is running and configured correctly\n3. Try refreshing the page and submitting again\n4. Use Local mode as a fallback\n\n**Technical Details:** " + error.message;
                }
            } else {
                errorMessage += "**Unknown Error**\n\nAn unknown error occurred.\n\n**Troubleshooting Steps:**\n1. Check browser console (F12) for details\n2. Verify server is running\n3. Try Local mode instead\n\n**Need Help?** Check server logs for more information";
            }
            
            this.appendChatMessage(errorMessage, 'llm error');
            
            // Fallback to local generation
            setTimeout(() => {
                try {
                    const workoutData = this.workoutGenerator.generateWorkout(message);
                    this.visualizer.createWorkoutFromData(workoutData);
                    const duration = Math.round(workoutData.totalDuration / 60);
                    const successMsg = `✅ Created "${workoutData.name}" (Local) - ${duration} minutes, TSS: ${workoutData.tss}`;
                    this.appendChatMessage(successMsg, 'llm');
                    const xmlContent = generateZWOContent(workoutData);
                    this.addDebugXMLButton(xmlContent, workoutData);
                } catch (fallbackError) {
                    console.error('Fallback generation also failed:', fallbackError);
                    this.appendChatMessage('❌ Both LLM and local generation failed. Please try a simpler request.', 'llm');
                }
            }, 500);
        }
    }

    appendChatMessage(text, sender) {
        const chatMessages = document.getElementById('chatMessages');
        const msgDiv = document.createElement('div');
        msgDiv.className = 'chat-message ' + sender;
        msgDiv.textContent = text;
        chatMessages.appendChild(msgDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    removeLastChatMessage() {
        const chatMessages = document.getElementById('chatMessages');
        if (chatMessages.lastChild) {
            chatMessages.removeChild(chatMessages.lastChild);
        }
    }

    addDebugXMLButton(xmlContent, workoutData) {
        const chatMessages = document.getElementById('chatMessages');
        const debugDiv = document.createElement('div');
        debugDiv.className = 'chat-message llm debug';
        debugDiv.innerHTML = `
            <button id="showXmlBtn" class="px-3 py-1 bg-blue-500 text-white rounded text-sm hover:bg-blue-600 mr-2">
                🔍 Show XML Debug
            </button>
            <button id="showStructureBtn" class="px-3 py-1 bg-green-500 text-white rounded text-sm hover:bg-green-600">
                📋 Show Workout Structure
            </button>
        `;
        chatMessages.appendChild(debugDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;

        // Add event listeners
        document.getElementById('showXmlBtn').addEventListener('click', () => {
            this.showXMLModal(xmlContent);
        });
        
        document.getElementById('showStructureBtn').addEventListener('click', () => {
            this.showStructureModal(workoutData);
        });
    }

    showXMLModal(xmlContent) {
        // Create modal overlay
        const overlay = document.createElement('div');
        overlay.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
        overlay.innerHTML = `
            <div class="bg-white rounded-lg p-6 max-w-4xl max-h-96 overflow-auto m-4">
                <div class="flex justify-between items-center mb-4">
                    <h3 class="text-lg font-semibold">Generated XML Debug</h3>
                    <button id="closeXmlModal" class="text-gray-500 hover:text-gray-700 text-xl">&times;</button>
                </div>
                <div class="bg-gray-100 p-4 rounded text-xs font-mono overflow-auto max-h-64">
                    <pre>${this.escapeHtml(xmlContent)}</pre>
                </div>
                <div class="mt-4 text-right">
                    <button id="copyXmlBtn" class="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 mr-2">
                        Copy XML
                    </button>
                    <button id="downloadXmlBtn" class="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600">
                        Download XML
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(overlay);

        // Add event listeners
        document.getElementById('closeXmlModal').addEventListener('click', () => {
            document.body.removeChild(overlay);
        });
        
        document.getElementById('copyXmlBtn').addEventListener('click', () => {
            navigator.clipboard.writeText(xmlContent);
            this.showToast('XML copied to clipboard');
        });
        
        document.getElementById('downloadXmlBtn').addEventListener('click', () => {
            downloadFile(xmlContent, 'debug_workout.zwo', 'application/xml');
            this.showToast('XML downloaded');
        });

        // Close on outside click
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                document.body.removeChild(overlay);
            }
        });
    }

    showStructureModal(workoutData) {
        // Create modal overlay
        const overlay = document.createElement('div');
        overlay.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
        overlay.innerHTML = `
            <div class="bg-white rounded-lg p-6 max-w-4xl max-h-96 overflow-auto m-4">
                <div class="flex justify-between items-center mb-4">
                    <h3 class="text-lg font-semibold">Workout Structure Debug</h3>
                    <button id="closeStructureModal" class="text-gray-500 hover:text-gray-700 text-xl">&times;</button>
                </div>
                <div class="bg-gray-100 p-4 rounded text-xs font-mono overflow-auto max-h-64">
                    <pre>${this.escapeHtml(JSON.stringify(workoutData, null, 2))}</pre>
                </div>
                <div class="mt-4 text-right">
                    <button id="copyStructureBtn" class="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
                        Copy Structure
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(overlay);

        // Add event listeners
        document.getElementById('closeStructureModal').addEventListener('click', () => {
            document.body.removeChild(overlay);
        });
        
        document.getElementById('copyStructureBtn').addEventListener('click', () => {
            navigator.clipboard.writeText(JSON.stringify(workoutData, null, 2));
            this.showToast('Structure copied to clipboard');
        });

        // Close on outside click
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                document.body.removeChild(overlay);
            }
        });
    }

    escapeHtml(text) {
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            '\'': '&#039;'
        };
        return text.replace(/[&<>"']/g, function(m) { return map[m]; });
    }

    async showSaveAsDialog() {
        if (!this.visualizer.workout) {
            this.showToast('Please load a workout first');
            return;
        }

        try {
            // Get the default Zwift directory
            const zwiftDirectory = await getZwiftWorkoutDirectory();
            
            // Create and show the save dialog
            const dialog = this.createSaveAsDialog(zwiftDirectory);
            document.body.appendChild(dialog);
        } catch (error) {
            console.error('Error showing save dialog:', error);
            this.showToast('Error opening save dialog');
        }
    }

    createSaveAsDialog(defaultDirectory) {
        const dialog = document.createElement('div');
        dialog.id = 'saveAsDialog';
        dialog.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-50';
        
        const workoutName = this.visualizer.workout.workoutData.name || 'Custom Workout';
        const sanitizedName = workoutName.replace(/[^a-z0-9\s-]/gi, '').replace(/\s+/g, '_');
        
        dialog.innerHTML = `
            <div class="bg-white rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl">
                <div class="flex items-center mb-4">
                    <svg class="w-6 h-6 text-emerald-600 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3-3m0 0l-3 3m3-3v12"></path>
                    </svg>
                    <h3 class="text-xl font-semibold text-gray-800">Save Workout As</h3>
                </div>
                
                <div class="space-y-4">
                    <div>
                        <label for="saveAsFilename" class="block text-sm font-medium text-gray-700 mb-2">
                            Filename:
                        </label>
                        <input 
                            type="text" 
                            id="saveAsFilename" 
                            value="${sanitizedName}"
                            class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                            placeholder="Enter filename (without .zwo)"
                        />
                        <p class="text-xs text-gray-500 mt-1">.zwo extension will be added automatically</p>
                    </div>
                    
                    <div>
                        <label for="saveAsDirectory" class="block text-sm font-medium text-gray-700 mb-2">
                            Save Location:
                        </label>
                        <div class="flex gap-2">
                            <input 
                                type="text" 
                                id="saveAsDirectory" 
                                value="${defaultDirectory || ''}"
                                class="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                                placeholder="Choose directory path"
                            />
                            <button 
                                type="button"
                                id="browseFolder" 
                                class="px-4 py-2 bg-gray-100 hover:bg-gray-200 border border-gray-300 rounded-lg text-gray-700 font-medium transition-all duration-200 flex items-center"
                            >
                                <svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-5l-2-2H5a2 2 0 00-2 2z"></path>
                                </svg>
                                Browse...
                            </button>
                        </div>
                        <p class="text-xs text-gray-500 mt-1">Click "Browse..." to select a folder or use the default Zwift workout directory</p>
                    </div>
                    
                    <div class="bg-blue-50 border border-blue-200 rounded-lg p-3">
                        <div class="flex items-center">
                            <svg class="w-4 h-4 text-blue-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                            </svg>
                            <span class="text-xs text-blue-800">File will be saved as: <strong id="previewFilename">${sanitizedName}.zwo</strong></span>
                        </div>
                    </div>
                </div>
                
                <div class="flex gap-3 mt-6">
                    <button 
                        id="saveAsCancel" 
                        class="flex-1 px-4 py-2 bg-gray-300 hover:bg-gray-400 text-gray-700 font-medium rounded-lg transition-all duration-200"
                    >
                        Cancel
                    </button>
                    <button 
                        id="saveAsConfirm" 
                        class="flex-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg transition-all duration-200"
                    >
                        Save Workout
                    </button>
                </div>
            </div>
        `;

        // Add event listeners
        const filenameInput = dialog.querySelector('#saveAsFilename');
        const previewFilename = dialog.querySelector('#previewFilename');
        
        filenameInput.addEventListener('input', (e) => {
            const sanitized = e.target.value.replace(/[^a-z0-9\s-]/gi, '').replace(/\s+/g, '_');
            previewFilename.textContent = `${sanitized}.zwo`;
        });

        dialog.querySelector('#saveAsCancel').addEventListener('click', () => {
            document.body.removeChild(dialog);
        });

        dialog.querySelector('#saveAsConfirm').addEventListener('click', () => {
            this.handleSaveAsConfirm(dialog);
        });

        dialog.querySelector('#browseFolder').addEventListener('click', () => {
            this.handleBrowseFolder(dialog);
        });

        // Close on background click
        dialog.addEventListener('click', (e) => {
            if (e.target === dialog) {
                document.body.removeChild(dialog);
            }
        });

        return dialog;
    }

    async handleBrowseFolder(dialog) {
        try {
            const browseBtn = dialog.querySelector('#browseFolder');
            const directoryInput = dialog.querySelector('#saveAsDirectory');
            
            // Show loading state
            const originalText = browseBtn.innerHTML;
            browseBtn.innerHTML = `
                <svg class="w-4 h-4 mr-1 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
                </svg>
                Loading...
            `;
            browseBtn.disabled = true;

            // Request folder selection from backend
            const selectedFolder = await selectFolder();
            
            // Restore button state
            browseBtn.innerHTML = originalText;
            browseBtn.disabled = false;
            
            if (selectedFolder) {
                directoryInput.value = selectedFolder;
                this.showToast('Folder selected successfully');
            }
        } catch (error) {
            console.error('Error browsing folders:', error);
            this.showToast('Error opening folder dialog');
            
            // Restore button state
            const browseBtn = dialog.querySelector('#browseFolder');
            if (browseBtn) {
                browseBtn.innerHTML = `
                    <svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-5l-2-2H5a2 2 0 00-2 2z"></path>
                    </svg>
                    Browse...
                `;
                browseBtn.disabled = false;
            }
        }
    }

    async handleSaveAsConfirm(dialog) {
        const filename = dialog.querySelector('#saveAsFilename').value.trim();
        const directory = dialog.querySelector('#saveAsDirectory').value.trim();

        if (!filename) {
            this.showToast('Please enter a filename');
            return;
        }

        // Sanitize filename
        const sanitizedFilename = filename.replace(/[^a-z0-9\s-]/gi, '').replace(/\s+/g, '_');
        const fullFilename = sanitizedFilename.endsWith('.zwo') ? sanitizedFilename : `${sanitizedFilename}.zwo`;

        try {
            // Show loading state
            const confirmBtn = dialog.querySelector('#saveAsConfirm');
            const originalText = confirmBtn.textContent;
            confirmBtn.textContent = 'Saving...';
            confirmBtn.disabled = true;

            // Generate ZWO content
            const zwoContent = generateZWOContent(this.visualizer.workout.workoutData);
            
            // Save the file
            const savedPath = await saveAsWorkout(fullFilename, zwoContent, directory);
            
            // Close dialog and show success message
            document.body.removeChild(dialog);
            this.showToast(`Workout saved successfully to: ${savedPath}`);
            
        } catch (error) {
            console.error('Error saving workout:', error);
            this.showToast(`Error saving workout: ${error.message}`);
            
            // Restore button state
            const confirmBtn = dialog.querySelector('#saveAsConfirm');
            if (confirmBtn) {
                confirmBtn.textContent = 'Save Workout';
                confirmBtn.disabled = false;
            }
        }
    }
}
