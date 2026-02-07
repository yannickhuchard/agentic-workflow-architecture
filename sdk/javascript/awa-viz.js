/**
 * AWA Visualization Library
 * A unified library for rendering AWA workflows in 2D (ReactFlow) and 3D (Babylon.js)
 * 
 * IMPORTANT: This library uses custom ReactFlow node types that include Handle components.
 * Handles are REQUIRED for edge connectivity. Without them, edges cannot connect to nodes.
 * 
 * Key Features:
 * - Automatic lane-based node positioning
 * - Custom node types with source/target handles for edge connectivity
 * - SLA progress bars and bottleneck visualization
 * - Interactive details panel for nodes and edges
 * - Workflow analytics (total duration, bottleneck count)
 * 
 * @version 1.1.0
 * @license Apache-2.0
 */

(function (global) {
    'use strict';

    // ============================================================================
    // AWA VISUALIZATION NAMESPACE
    // ============================================================================

    const AWAViz = {
        version: '1.1.0',
        renderers: {},
        utils: {}
    };

    // ============================================================================
    // UTILITY FUNCTIONS
    // ============================================================================

    AWAViz.utils = {
        /**
         * Convert hex color to RGB object
         */
        hexToRgb: function (hex) {
            const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
            return result ? {
                r: parseInt(result[1], 16) / 255,
                g: parseInt(result[2], 16) / 255,
                b: parseInt(result[3], 16) / 255
            } : null;
        },

        /**
         * Convert node ID to display label
         */
        nodeIdToLabel: function (nodeId) {
            return nodeId
                .replace(/^(act|dec|evt)-/, '')
                .replace(/-/g, ' ')
                .split(' ')
                .map(w => w.charAt(0).toUpperCase() + w.slice(1))
                .join(' ');
        },

        /**
         * Deep merge objects
         */
        deepMerge: function (target, source) {
            const result = Object.assign({}, target);
            for (const key in source) {
                if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
                    result[key] = this.deepMerge(result[key] || {}, source[key]);
                } else {
                    result[key] = source[key];
                }
            }
            return result;
        },

        /**
         * Create DOM element with attributes
         */
        createElement: function (tag, attrs, children) {
            const el = document.createElement(tag);
            if (attrs) {
                for (const key in attrs) {
                    if (key === 'style' && typeof attrs[key] === 'object') {
                        Object.assign(el.style, attrs[key]);
                    } else if (key.startsWith('on')) {
                        el.addEventListener(key.slice(2).toLowerCase(), attrs[key]);
                    } else {
                        el.setAttribute(key, attrs[key]);
                    }
                }
            }
            if (children) {
                if (typeof children === 'string') {
                    el.textContent = children;
                } else if (Array.isArray(children)) {
                    children.forEach(child => el.appendChild(child));
                } else {
                    el.appendChild(children);
                }
            }
            return el;
        },

        /**
         * Calculate end-to-end workflow duration and detect bottlenecks
         */
        calculateWorkflowAnalytics: function (visualization) {
            const viz = visualization.visualization || visualization;
            const nodePositions = viz.node_positions_2d || viz.node_positions_3d || [];
            const edgeRoutings = viz.edge_routings || [];

            let totalDuration = 0;
            let bottlenecks = 0;

            // Simple sum for now - in a complex graph this would be the critical path
            nodePositions.forEach(node => {
                if (node.duration_ms) {
                    totalDuration += node.duration_ms;
                }
                if (node.duration_ms && node.bottleneck_threshold_ms && node.duration_ms > node.bottleneck_threshold_ms) {
                    bottlenecks++;
                }
            });

            edgeRoutings.forEach(edge => {
                if (edge.duration_ms) {
                    totalDuration += Number(edge.duration_ms);
                }
                if (edge.duration_ms && edge.bottleneck_threshold_ms && edge.duration_ms > edge.bottleneck_threshold_ms) {
                    bottlenecks++;
                }
            });

            return {
                totalDurationMs: totalDuration,
                totalDurationFormatted: (totalDuration / 1000).toFixed(1) + 's',
                bottleneckCount: bottlenecks,
                efficiency: totalDuration > 0 ? Math.max(0, 100 - (bottlenecks * 15)) : 100
            };
        },

        /**
         * Unified render function for React/ReactDOM compatibility (v17/v18)
         */
        reactRender: function (element, container) {
            if (typeof ReactDOM.createRoot === 'function') {
                if (!container._awaRoot) {
                    container._awaRoot = ReactDOM.createRoot(container);
                }
                container._awaRoot.render(element);
                return container._awaRoot;
            } else {
                ReactDOM.render(element, container);
                return null;
            }
        },

        /**
         * Safely unmount any visualization from a container
         */
        unmount: function (container) {
            if (!container) return;

            // 1. Unmount React (v18 or v17)
            if (container._awaRoot) {
                container._awaRoot.unmount();
                delete container._awaRoot;
            } else if (typeof ReactDOM !== 'undefined' && typeof ReactDOM.unmountComponentAtNode === 'function') {
                try {
                    ReactDOM.unmountComponentAtNode(container);
                } catch (e) {
                    // Ignore if already unmounted or not a React root
                }
            }

            // 2. Cleanup Babylon.js if present
            if (container._awaEngine) {
                container._awaEngine.dispose();
                delete container._awaEngine;
            }

            // 3. Clear DOM
            container.innerHTML = '';
        },

        /**
         * Deep merge objects (helper)
         */
        deepMerge: function (target, source) {
            for (const key in source) {
                if (source[key] instanceof Object && key in target) {
                    Object.assign(source[key], this.deepMerge(target[key], source[key]));
                }
            }
            Object.assign(target || {}, source);
            return target;
        }
    };

    // ============================================================================
    // 2D RENDERER (ReactFlow-based)
    // ============================================================================

    AWAViz.renderers.ReactFlow2D = {
        name: 'ReactFlow2D',

        /**
         * Check if ReactFlow is available
         */
        isAvailable: function () {
            const RF = window.ReactFlow || window.xyflowReact;
            return typeof React !== 'undefined' &&
                typeof ReactDOM !== 'undefined' &&
                !!RF;
        },

        /**
         * Convert AWA visualization config to ReactFlow format
         */
        convertToReactFlow: function (visualization, containerHeight) {
            const viz = visualization.visualization || visualization;
            console.log(`[AWAViz] Converting to ReactFlow. Nodes: ${viz.node_positions_2d?.length}, Edges: ${viz.edge_routings?.length}`);

            // Calculate lane positions if lanes are defined
            const laneMap = new Map();
            if (viz.lanes && viz.lanes.length > 0) {
                // Use actual container height or default
                const viewportHeight = containerHeight || 600;
                const laneHeight = viewportHeight / viz.lanes.length;

                console.log(`[AWAViz] Container height: ${viewportHeight}px, ${viz.lanes.length} lanes, ${laneHeight.toFixed(1)}px per lane`);

                viz.lanes.forEach((lane, index) => {
                    const yStart = index * laneHeight;
                    const yCenter = yStart + (laneHeight / 2);
                    const yEnd = yStart + laneHeight;

                    laneMap.set(lane.name, {
                        yStart,
                        yCenter,
                        yEnd,
                        height: laneHeight,
                        index: index,
                        ...lane
                    });

                    console.log(`[AWAViz] Lane ${index} "${lane.label || lane.name}": y ${yStart.toFixed(1)}-${yEnd.toFixed(1)}, center ${yCenter.toFixed(1)}`);
                });
            }

            const nodes = (viz.node_positions_2d || []).map(pos => {
                let yPosition = pos.position.y;
                const nodeHeight = pos.height || 60;

                // If node has a lane assignment, center it in that lane
                if (pos.lane && laneMap.has(pos.lane)) {
                    const lane = laneMap.get(pos.lane);
                    yPosition = lane.yCenter - (nodeHeight / 2);
                    console.log(`[AWAViz] Node "${pos.node_id}" in lane "${pos.lane}": y=${yPosition.toFixed(1)} (center ${lane.yCenter.toFixed(1)} - ${nodeHeight / 2})`);
                } else if (pos.lane) {
                    console.warn(`[AWAViz] Node "${pos.node_id}": lane "${pos.lane}" NOT FOUND!`);
                }

                const isBottleneck = pos.duration_ms && pos.bottleneck_threshold_ms && pos.duration_ms > pos.bottleneck_threshold_ms;
                const borderColor = isBottleneck ? '#ff4d4f' : (pos.style?.border_color || '#333333');
                const backgroundColor = isBottleneck ? '#fff1f0' : (pos.style?.background_color || '#ffffff');
                const borderWidth = isBottleneck ? 3 : (pos.style?.border_width || 1);

                return {
                    id: pos.node_id,
                    type: 'awa-activity',
                    position: { x: pos.position.x, y: yPosition },
                    data: {
                        label: AWAViz.utils.nodeIdToLabel(pos.node_id),
                        lane: pos.lane,
                        duration_ms: pos.duration_ms,
                        bottleneck_threshold_ms: pos.bottleneck_threshold_ms,
                        is_bottleneck: !!isBottleneck,
                        // Include all other fields from position config
                        ...Object.fromEntries(
                            Object.entries(pos).filter(([key]) =>
                                !['node_id', 'position', 'width', 'height', 'style', 'lane', 'node_type', 'id'].includes(key)
                            )
                        )
                    },
                    style: {
                        backgroundColor: backgroundColor,
                        borderColor: borderColor,
                        borderWidth: borderWidth,
                        borderRadius: pos.node_type === 'decision' ? 0 : (pos.style?.border_radius || 8),
                        borderStyle: 'solid',
                        width: pos.width || 150,
                        height: nodeHeight,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '11px',
                        fontWeight: '500',
                        padding: '8px',
                        boxShadow: isBottleneck ? '0 0 10px rgba(255, 77, 79, 0.5)' : 'none'
                    }
                };
            });

            const edges = (viz.edge_routings || []).map(route => {
                // Use explicit source/target if provided, otherwise parse edge_id
                let source = route.source;
                let target = route.target;

                if (!source || !target) {
                    const parts = route.edge_id.replace('edge-', '').split('-to-');
                    source = parts[0];
                    target = parts[1] || parts[0];
                }

                // Find matching node IDs (exact match or contains)
                const sourceNode = nodes.find(n => n.id === source || n.id.includes(source));
                const targetNode = nodes.find(n => n.id === target || n.id.includes(target));

                console.log(`[AWAViz] Edge "${route.edge_id}": source="${source}" (found: ${sourceNode?.id || 'NOT FOUND'}), target="${target}" (found: ${targetNode?.id || 'NOT FOUND'})`);

                // Work Transfer Icons
                const transferIcons = {
                    'request_reply': '🔁',
                    'notification': '🔔',
                    'manual_work': '👤'
                };
                const icon = transferIcons[route.transfer_type] || '';
                const label = route.label ? `${icon} ${route.label}` : icon;

                const isBottleneck = route.duration_ms && route.bottleneck_threshold_ms && route.duration_ms > route.bottleneck_threshold_ms;
                const strokeColor = isBottleneck ? '#ff4d4f' : (route.style?.stroke_color || '#666666');
                const strokeWidth = isBottleneck ? 4 : (route.style?.stroke_width || 2);

                return {
                    id: route.edge_id || `edge-${source}-${target}`,
                    source: sourceNode?.id || source,
                    target: targetNode?.id || target,
                    type: route.curve_type === 'smoothstep' ? 'smoothstep' :
                        route.curve_type === 'step' ? 'step' : 'default',
                    animated: route.animated || isBottleneck || false,
                    label: label,
                    data: {
                        transfer_type: route.transfer_type,
                        duration_ms: route.duration_ms,
                        bottleneck_threshold_ms: route.bottleneck_threshold_ms,
                        is_bottleneck: !!isBottleneck
                    },
                    markerEnd: {
                        type: 'arrowclosed',
                        width: 20,
                        height: 20,
                        color: strokeColor
                    },
                    style: {
                        stroke: strokeColor,
                        strokeWidth: strokeWidth
                    },
                    labelStyle: { fill: isBottleneck ? '#ff4d4f' : '#333', fontWeight: isBottleneck ? '700' : '400' },
                    zIndex: 1000
                };
            });

            console.log(`[AWAViz] ReactFlow ready: ${nodes.length} nodes, ${edges.length} edges`);
            return { nodes, edges, config: viz, laneMap };
        },

        /**
         * Render visualization to container
         */
        render: function (container, visualization, options) {
            if (!this.isAvailable()) {
                console.error('AWAViz: ReactFlow dependencies not loaded');
                container.innerHTML = `<div style="padding: 20px; color: #ef4444; background: #fee2e2; border: 1px solid #f87171; border-radius: 8px;">
                    <strong>AWAViz Error:</strong> ReactFlow dependencies not loaded.<br>
                    Please ensure React, ReactDOM, and ReactFlow are included via script tags.
                </div>`;
                return null;
            }

            // Ensure container is unmounted before re-rendering
            AWAViz.utils.unmount(container);

            const opts = AWAViz.utils.deepMerge({
                fitView: true,
                showMinimap: true,
                showControls: true,
                showBackground: true,
                containerHeight: null,
                layoutAlgorithm: 'none' // 'none', 'dagre', 'elk'
            }, options || {});

            // Get container dimensions - use provided height or measure
            const containerHeight = opts.containerHeight || container.clientHeight || 600;
            const containerWidth = container.clientWidth || 1400;

            const { nodes, edges, config, laneMap } = this.convertToReactFlow(visualization, containerHeight);
            const RF = window.xyflowReact || window.ReactFlow;
            const { createElement: h } = React;

            function App() {
                const [nodesState, setNodes, onNodesChange] = RF.useNodesState(nodes);
                const [edgesState, setEdges, onEdgesChange] = RF.useEdgesState(edges);
                const [selectedItem, setSelectedItem] = React.useState(null);
                const [activeTab, setActiveTab] = React.useState('details');
                const [showAnalytics, setShowAnalytics] = React.useState(false);
                const [analytics] = React.useState(() => AWAViz.utils.calculateWorkflowAnalytics(visualization));

                // Handle node click
                const onNodeClick = React.useCallback((event, node) => {
                    console.log('[AWAViz] Node clicked:', node.id);
                    setSelectedItem({
                        type: 'node',
                        id: node.id,
                        label: node.data.label,
                        lane: node.data.lane,
                        position: node.position,
                        style: node.style,
                        data: node.data
                    });
                    setActiveTab('details'); // Reset to details tab
                }, []);

                // Handle edge click
                const onEdgeClick = React.useCallback((event, edge) => {
                    console.log('[AWAViz] Edge clicked:', edge.id);
                    setSelectedItem({
                        type: 'edge',
                        id: edge.id,
                        source: edge.source,
                        target: edge.target,
                        label: edge.label,
                        animated: edge.animated,
                        style: edge.style,
                        data: edge.data
                    });
                    setActiveTab('details'); // Reset to details tab
                }, []);

                // Close details panel
                const closeDetails = React.useCallback(() => {
                    setSelectedItem(null);
                    setActiveTab('details');
                }, []);

                return h('div', { style: { width: '100%', height: '100%', position: 'relative' } }, [
                    h(RF.ReactFlow, {
                        nodes: nodesState,
                        edges: edgesState,
                        onNodesChange,
                        onEdgesChange,
                        onNodeClick,
                        onEdgeClick,
                        fitView: opts.fitView,
                        defaultViewport: { x: 0, y: 0, zoom: 1 },
                        translateExtent: [[0, 0], [containerWidth, containerHeight]],
                        minZoom: 0.2,
                        maxZoom: 2.0,
                        defaultEdgeOptions: {
                            type: 'smoothstep',
                            style: { stroke: '#333', strokeWidth: 2 },
                            markerEnd: { type: 'arrowclosed', color: '#333' }
                        },
                        nodeTypes: {
                            'awa-activity': (props) => {
                                const { data, style } = props;
                                const slaPercent = data.duration_ms && data.bottleneck_threshold_ms
                                    ? Math.min(100, (data.duration_ms / data.bottleneck_threshold_ms) * 100)
                                    : 0;
                                const slaColor = slaPercent > 90 ? '#ef4444' : slaPercent > 70 ? '#f59e0b' : '#10b981';

                                return h('div', {
                                    className: 'awa-node',
                                    onClick: (e) => {
                                        // Ensure click propagates to ReactFlow but also trigger our detail panel
                                        onNodeClick(e, props);
                                    },
                                    style: {
                                        ...style,
                                        position: 'relative',
                                        overflow: 'visible',
                                        border: props.selected ? '3px solid #667eea' : (style?.border || 'none'),
                                        boxShadow: props.selected ? '0 0 10px rgba(102, 126, 234, 0.5)' : 'none',
                                        cursor: 'pointer'
                                    }
                                }, [
                                    // TARGET HANDLE - Left side
                                    h(RF.Handle, {
                                        type: 'target',
                                        position: 'left',
                                        style: { background: '#333', width: 10, height: 10, left: -5, borderRadius: '50%', border: '2px solid #fff' }
                                    }),
                                    // Node content
                                    h('div', {
                                        className: 'awa-node-label',
                                        style: { padding: '8px', textAlign: 'center', width: '100%', pointerEvents: 'none' }
                                    }, data.label),
                                    // SLA Progress Bar
                                    data.bottleneck_threshold_ms && h('div', {
                                        className: 'awa-sla-bar',
                                        style: {
                                            position: 'absolute',
                                            bottom: 0,
                                            left: 0,
                                            width: '100%',
                                            height: '4px',
                                            background: 'rgba(0,0,0,0.1)',
                                            pointerEvents: 'none'
                                        }
                                    }, [
                                        h('div', {
                                            className: 'awa-sla-progress',
                                            style: {
                                                width: `${slaPercent}%`,
                                                height: '100%',
                                                background: slaColor,
                                                transition: 'width 0.5s ease-in-out'
                                            }
                                        })
                                    ]),
                                    // SOURCE HANDLE - Right side
                                    h(RF.Handle, {
                                        type: 'source',
                                        position: 'right',
                                        style: { background: '#333', width: 10, height: 10, right: -5, borderRadius: '50%', border: '2px solid #fff' }
                                    })
                                ]);
                            }
                        },
                        panOnScroll: true,
                        preventScrolling: true,
                        style: {
                            background: 'transparent',
                            width: '100%',
                            height: '100%'
                        }
                    }, [
                        opts.showBackground && h(RF.Background, {
                            color: config.theme?.grid_color || '#e0e0e0',
                            gap: config.theme?.grid_size || 20
                        }),
                        opts.showControls && h(RF.Controls, {}),
                        opts.showMinimap && h(RF.MiniMap, {
                            nodeColor: '#667eea',
                            maskColor: 'rgba(0,0,0,0.1)'
                        })
                    ]),
                    // Details/Analytics panel container
                    h('div', {
                        style: {
                            position: 'absolute',
                            top: '20px',
                            right: '20px',
                            width: '320px',
                            maxHeight: '80%',
                            overflowY: 'auto',
                            background: 'white',
                            borderRadius: '12px',
                            boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
                            padding: '0',
                            zIndex: 1000,
                            fontFamily: "'Segoe UI', sans-serif"
                        }
                    }, [
                        // Workflow Summary (if nothing selected)
                        !selectedItem ? h('div', { style: { padding: '20px', background: '#f8f9fa', borderRadius: '12px' } }, [
                            h('div', { style: { fontSize: '14px', fontWeight: '700', color: '#333', marginBottom: '12px', display: 'flex', alignItems: 'center' } }, '📊 Workflow Analytics'),
                            h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' } }, [
                                h('div', { style: { background: 'white', padding: '10px', borderRadius: '8px', border: '1px solid #eee' } }, [
                                    h('div', { style: { fontSize: '10px', color: '#888', textTransform: 'uppercase' } }, 'Total Duration'),
                                    h('div', { style: { fontSize: '18px', fontWeight: '700', color: '#667eea' } }, analytics.totalDurationFormatted)
                                ]),
                                h('div', { style: { background: 'white', padding: '10px', borderRadius: '8px', border: '1px solid #eee' } }, [
                                    h('div', { style: { fontSize: '10px', color: '#888', textTransform: 'uppercase' } }, 'Bottlenecks'),
                                    h('div', { style: { fontSize: '18px', fontWeight: '700', color: analytics.bottleneckCount > 0 ? '#ff4d4f' : '#52c41a' } }, analytics.bottleneckCount)
                                ])
                            ])
                        ]) : [
                            // Header
                            h('div', {
                                style: {
                                    background: selectedItem.type === 'node'
                                        ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
                                        : 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)',
                                    color: 'white',
                                    padding: '16px 20px',
                                    borderRadius: '12px 12px 0 0',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center'
                                }
                            }, [
                                h('h3', {
                                    style: { margin: 0, fontSize: '16px', fontWeight: '600' }
                                }, selectedItem.type === 'node' ? 'Activity Details' : 'Edge Details'),
                                h('button', {
                                    onClick: closeDetails,
                                    style: {
                                        background: 'rgba(255,255,255,0.2)',
                                        border: 'none',
                                        color: 'white',
                                        width: '28px',
                                        height: '28px',
                                        borderRadius: '50%',
                                        cursor: 'pointer',
                                        fontSize: '18px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        transition: 'background 0.2s'
                                    },
                                    onMouseEnter: (e) => e.target.style.background = 'rgba(255,255,255,0.3)',
                                    onMouseLeave: (e) => e.target.style.background = 'rgba(255,255,255,0.2)'
                                }, '×')
                            ]),
                            // Tab Navigation
                            h('div', {
                                style: {
                                    display: 'flex',
                                    borderBottom: '1px solid #e5e5e5',
                                    background: '#f9fafb'
                                }
                            }, [
                                h('button', {
                                    onClick: () => setActiveTab('details'),
                                    style: {
                                        flex: 1,
                                        padding: '12px 16px',
                                        border: 'none',
                                        background: activeTab === 'details' ? 'white' : 'transparent',
                                        borderBottom: activeTab === 'details' ? '2px solid #667eea' : '2px solid transparent',
                                        color: activeTab === 'details' ? '#667eea' : '#6b7280',
                                        fontWeight: activeTab === 'details' ? '600' : '400',
                                        fontSize: '13px',
                                        cursor: 'pointer',
                                        transition: 'all 0.2s'
                                    }
                                }, selectedItem.type === 'node' ? 'Activity Data' : 'Edge Data'),
                                h('button', {
                                    onClick: () => setActiveTab('technical'),
                                    style: {
                                        flex: 1,
                                        padding: '12px 16px',
                                        border: 'none',
                                        background: activeTab === 'technical' ? 'white' : 'transparent',
                                        borderBottom: activeTab === 'technical' ? '2px solid #667eea' : '2px solid transparent',
                                        color: activeTab === 'technical' ? '#667eea' : '#6b7280',
                                        fontWeight: activeTab === 'technical' ? '600' : '400',
                                        fontSize: '13px',
                                        cursor: 'pointer',
                                        transition: 'all 0.2s'
                                    }
                                }, 'Visualization')
                            ]),
                            // Content
                            h('div', { style: { padding: '20px' } }, [
                                selectedItem.type === 'node' ? [
                                    activeTab === 'details' ? [
                                        h('div', { style: { marginBottom: '16px' } }, [
                                            h('div', { style: { fontSize: '12px', color: '#666', marginBottom: '4px' } }, 'Name'),
                                            h('div', { style: { fontSize: '15px', fontWeight: '600', color: '#333' } }, selectedItem.label)
                                        ]),
                                        h('div', { style: { marginBottom: '16px' } }, [
                                            h('div', { style: { fontSize: '12px', color: '#666', marginBottom: '4px' } }, 'ID'),
                                            h('code', {
                                                style: {
                                                    fontSize: '13px',
                                                    background: '#f5f5f5',
                                                    color: '#1a1a1a',
                                                    padding: '4px 8px',
                                                    borderRadius: '4px',
                                                    display: 'inline-block',
                                                    fontFamily: 'monospace'
                                                }
                                            }, selectedItem.id)
                                        ]),
                                        selectedItem.lane && h('div', { style: { marginBottom: '16px' } }, [
                                            h('div', { style: { fontSize: '12px', color: '#666', marginBottom: '4px' } }, 'Lane'),
                                            h('div', {
                                                style: {
                                                    fontSize: '14px',
                                                    background: selectedItem.style.backgroundColor || '#f0f0f0',
                                                    color: '#333',
                                                    padding: '6px 12px',
                                                    borderRadius: '6px',
                                                    display: 'inline-block',
                                                    border: `2px solid ${selectedItem.style.borderColor || '#ccc'}`
                                                }
                                            }, selectedItem.lane)
                                        ]),
                                        // Metrics Section
                                        (selectedItem.data?.duration_ms || selectedItem.data?.is_bottleneck) && h('div', { style: { marginBottom: '16px', background: selectedItem.data?.is_bottleneck ? '#fff1f0' : '#f0f7ff', padding: '12px', borderRadius: '8px', border: `1px solid ${selectedItem.data?.is_bottleneck ? '#ffa39e' : '#bae7ff'}` } }, [
                                            h('div', { style: { fontSize: '12px', color: selectedItem.data?.is_bottleneck ? '#cf1322' : '#0050b3', fontWeight: '600', marginBottom: '8px' } }, '⏱️ Execution Metrics'),
                                            h('div', { style: { display: 'flex', justifyContent: 'space-between' } }, [
                                                h('div', {}, [
                                                    h('div', { style: { fontSize: '10px', color: '#888' } }, 'Duration'),
                                                    h('div', { style: { fontSize: '14px', fontWeight: '700' } }, selectedItem.data?.duration_ms + 'ms')
                                                ]),
                                                selectedItem.data?.is_bottleneck && h('div', { style: { textAlign: 'right' } }, [
                                                    h('div', { style: { fontSize: '10px', color: '#cf1322' } }, 'Status'),
                                                    h('div', { style: { fontSize: '12px', fontWeight: '700', color: '#cf1322' } }, '⚠️ BOTTLENECK')
                                                ])
                                            ])
                                        ]),
                                        // Display procedure field prominently if present
                                        selectedItem.data.procedure && h('div', { style: { marginBottom: '16px', borderTop: '1px solid #e5e5e5', paddingTop: '12px', marginTop: '4px' } }, [
                                            h('div', { style: { fontSize: '12px', color: '#666', marginBottom: '8px', fontWeight: '600' } }, '📋 Procedure'),
                                            h('div', {
                                                style: {
                                                    fontSize: '13px',
                                                    color: '#1a1a1a',
                                                    lineHeight: '1.6',
                                                    background: '#f8f9fa',
                                                    padding: '12px',
                                                    borderRadius: '6px',
                                                    border: '1px solid #e5e5e5',
                                                    whiteSpace: 'pre-wrap',
                                                    fontFamily: 'monospace'
                                                }
                                            }, selectedItem.data.procedure)
                                        ]),
                                        // Additional Properties logic
                                        (() => {
                                            const entries = Object.entries(selectedItem.data || {})
                                                .filter(([key]) => !['label', 'lane', 'procedure', 'duration_ms', 'bottleneck_threshold_ms', 'is_bottleneck'].includes(key));
                                            if (entries.length === 0) return null;
                                            return h('div', { style: { marginBottom: '16px', borderTop: '1px solid #e5e5e5', paddingTop: '12px', marginTop: '4px' } }, [
                                                h('div', { style: { fontSize: '12px', color: '#666', marginBottom: '8px', fontWeight: '600' } }, 'Additional Properties'),
                                                ...entries.map(([key, value]) =>
                                                    h('div', { style: { marginBottom: '8px' } }, [
                                                        h('div', { style: { fontSize: '11px', color: '#888', marginBottom: '2px', textTransform: 'capitalize' } }, key.replace(/_/g, ' ')),
                                                        h('div', { style: { fontSize: '13px', color: '#333', wordBreak: 'break-word' } },
                                                            typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value))
                                                    ])
                                                )
                                            ]);
                                        })()
                                    ] : [
                                        // Node Visualization Tab
                                        h('div', { style: { marginBottom: '16px' } }, [
                                            h('div', { style: { fontSize: '12px', color: '#666', marginBottom: '4px' } }, 'Position'),
                                            h('div', { style: { fontSize: '13px', color: '#555' } },
                                                `X: ${selectedItem.position ? Math.round(selectedItem.position.x) : 'N/A'}, Y: ${selectedItem.position ? Math.round(selectedItem.position.y) : 'N/A'}`)
                                        ]),
                                        h('div', { style: { marginBottom: '16px' } }, [
                                            h('div', { style: { fontSize: '12px', color: '#666', marginBottom: '4px' } }, 'Dimensions'),
                                            h('div', { style: { fontSize: '13px', color: '#555' } },
                                                `${selectedItem.style.width}px × ${selectedItem.style.height}px`)
                                        ]),
                                        h('div', { style: { marginBottom: '0' } }, [
                                            h('div', { style: { fontSize: '12px', color: '#666', marginBottom: '4px' } }, 'Styling'),
                                            h('div', { style: { fontSize: '13px', color: '#555', lineHeight: '1.6' } }, [
                                                h('div', {}, `Background: ${selectedItem.style.backgroundColor}`),
                                                h('div', {}, `Border: ${selectedItem.style.borderWidth}px ${selectedItem.style.borderColor}`),
                                                h('div', {}, `Radius: ${selectedItem.style.borderRadius}px`)
                                            ])
                                        ])
                                    ]
                                ] : [
                                    // Edge View
                                    activeTab === 'details' ? [
                                        h('div', { style: { marginBottom: '16px' } }, [
                                            h('div', { style: { fontSize: '12px', color: '#666', marginBottom: '4px' } }, 'ID'),
                                            h('code', {
                                                style: {
                                                    fontSize: '13px',
                                                    background: '#f5f5f5',
                                                    color: '#1a1a1a',
                                                    padding: '4px 8px',
                                                    borderRadius: '4px',
                                                    display: 'inline-block',
                                                    fontFamily: 'monospace'
                                                }
                                            }, selectedItem.id)
                                        ]),
                                        h('div', { style: { marginBottom: '16px' } }, [
                                            h('div', { style: { fontSize: '12px', color: '#666', marginBottom: '4px' } }, 'Flow'),
                                            h('div', {
                                                style: {
                                                    fontSize: '14px',
                                                    background: '#f8f9fa',
                                                    padding: '10px 14px',
                                                    borderRadius: '6px',
                                                    color: '#333'
                                                }
                                            }, `${selectedItem.source} → ${selectedItem.target}`)
                                        ]),
                                        // Edge Metrics & Transfer
                                        h('div', { style: { marginBottom: '16px', background: selectedItem.data?.is_bottleneck ? '#fff1f0' : '#f6ffed', padding: '12px', borderRadius: '8px', border: `1px solid ${selectedItem.data?.is_bottleneck ? '#ffa39e' : '#b7eb8f'}` } }, [
                                            h('div', { style: { fontSize: '12px', color: selectedItem.data?.is_bottleneck ? '#cf1322' : '#389e0d', fontWeight: '600', marginBottom: '8px' } }, '🔄 Transfer & Flow'),
                                            selectedItem.data?.transfer_type && h('div', { style: { marginBottom: '8px' } }, [
                                                h('div', { style: { fontSize: '10px', color: '#888' } }, 'Transfer Mode'),
                                                h('div', { style: { fontSize: '13px', fontWeight: '600', textTransform: 'capitalize' } }, selectedItem.data?.transfer_type.replace(/_/g, ' '))
                                            ]),
                                            h('div', { style: { display: 'flex', justifyContent: 'space-between' } }, [
                                                h('div', {}, [
                                                    h('div', { style: { fontSize: '10px', color: '#888' } }, 'Transition Time'),
                                                    h('div', { style: { fontSize: '14px', fontWeight: '700' } }, (selectedItem.data?.duration_ms || 0) + 'ms')
                                                ]),
                                                selectedItem.data?.is_bottleneck && h('div', { style: { textAlign: 'right' } }, [
                                                    h('div', { style: { fontSize: '10px', color: '#cf1322' } }, 'Status'),
                                                    h('div', { style: { fontSize: '12px', fontWeight: '700', color: '#cf1322' } }, '⚠️ SLOW FLOW')
                                                ])
                                            ])
                                        ]),
                                        selectedItem.label && h('div', { style: { marginBottom: '0' } }, [
                                            h('div', { style: { fontSize: '12px', color: '#666', marginBottom: '4px' } }, 'Label'),
                                            h('div', { style: { fontSize: '14px', color: '#555', fontWeight: '500' } }, selectedItem.label)
                                        ])
                                    ] : [
                                        // Edge Visualization Tab
                                        h('div', { style: { marginBottom: '16px' } }, [
                                            h('div', { style: { fontSize: '12px', color: '#666', marginBottom: '4px' } }, 'Animated'),
                                            h('div', {
                                                style: {
                                                    fontSize: '13px',
                                                    color: selectedItem.animated ? '#10b981' : '#6b7280',
                                                    fontWeight: '500'
                                                }
                                            }, selectedItem.animated ? '✓ Yes' : '✗ No')
                                        ]),
                                        h('div', { style: { marginBottom: '0' } }, [
                                            h('div', { style: { fontSize: '12px', color: '#666', marginBottom: '4px' } }, 'Style'),
                                            h('div', {
                                                style: {
                                                    fontSize: '13px',
                                                    background: '#f5f5f5',
                                                    padding: '8px 12px',
                                                    borderRadius: '6px',
                                                    color: '#555'
                                                }
                                            }, `Color: ${selectedItem.style.stroke}, Width: ${selectedItem.style.strokeWidth}px`)
                                        ])
                                    ]
                                ]
                            ])
                        ]
                    ])
                ]);
            }

            console.log(`[AWAViz] ReactFlow viewport: ${containerWidth}x${containerHeight}px, zoom=1.0 (1:1 with lanes)`);

            // Use React 17 render API (not React 18's createRoot)
            // Use the utility for compatibility
            AWAViz.utils.reactRender(h(App), container);

            // Return with diagnostic data
            return {
                container,
                nodes,
                edges,
                diagnostics: {
                    containerHeight,
                    containerWidth,
                    lanes: Array.from(laneMap.entries()).map(([name, lane]) => ({
                        name,
                        yStart: lane.yStart,
                        yCenter: lane.yCenter,
                        yEnd: lane.yEnd
                    })),
                    nodes: nodes.map(n => ({
                        id: n.id,
                        lane: n.data.lane,
                        y: n.position.y,
                        height: n.style.height
                    }))
                }
            };
        }
    };

    // ============================================================================
    // 3D RENDERER (Babylon.js-based)
    // ============================================================================

    AWAViz.renderers.Babylon3D = {
        name: 'Babylon3D',

        /**
         * Check if Babylon.js is available
         */
        isAvailable: function () {
            return typeof BABYLON !== 'undefined' &&
                typeof React !== 'undefined' &&
                typeof ReactDOM !== 'undefined';
        },

        /**
         * Convert hex to Babylon Color3
         */
        hexToColor3: function (hex) {
            const rgb = AWAViz.utils.hexToRgb(hex);
            return rgb ? new BABYLON.Color3(rgb.r, rgb.g, rgb.b) : new BABYLON.Color3(0.5, 0.5, 0.5);
        },

        /**
         * Create a mesh for an edge
         */
        createEdgeMesh: function (sourcePos, targetPos, edgeData, scene) {
            const start = new BABYLON.Vector3(sourcePos.x, sourcePos.y, sourcePos.z);
            const end = new BABYLON.Vector3(targetPos.x, targetPos.y, targetPos.z);

            // Bottleneck coloring
            const isBottleneck = edgeData.duration_ms && edgeData.bottleneck_threshold_ms && edgeData.duration_ms > edgeData.bottleneck_threshold_ms;
            const strokeColor = isBottleneck ? '#ff4d4f' : (edgeData.style?.stroke_color || '#666666');

            const mat = new BABYLON.PBRMaterial(edgeData.edge_id + '_mat', scene);
            mat.albedoColor = this.hexToColor3(strokeColor);
            mat.emissiveColor = this.hexToColor3(strokeColor);
            mat.emissiveIntensity = isBottleneck ? 0.8 : 0.2;
            mat.metallic = 0.5;
            mat.roughness = 0.3;

            const tube = BABYLON.MeshBuilder.CreateTube(edgeData.edge_id, {
                path: path,
                radius: isBottleneck ? 0.15 : 0.08,
                tessellation: 12,
                cap: BABYLON.Mesh.CAP_ALL
            }, scene);
            tube.material = mat;

            const arrowHead = BABYLON.MeshBuilder.CreateCylinder(edgeData.edge_id + '_arrow', {
                height: 0.5,
                diameterTop: 0,
                diameterBottom: 0.4,
                tessellation: 12
            }, scene);
            arrowHead.material = mat;

            // Position arrow head at end point
            arrowHead.position = end;

            // Point cone at start
            arrowHead.lookAt(start);
            arrowHead.rotate(BABYLON.Axis.X, Math.PI / 2, BABYLON.Space.LOCAL);

            // Container for both
            const container = new BABYLON.TransformNode(edgeData.edge_id + '_group', scene);
            tube.parent = container;
            arrowHead.parent = container;

            // Add metadata for picking
            const edgeMetadata = {
                type: 'edge',
                id: edgeData.edge_id,
                label: edgeData.label || edgeData.edge_id,
                data: {
                    ...edgeData,
                    is_bottleneck: !!isBottleneck
                }
            };
            tube.metadata = edgeMetadata;
            arrowHead.metadata = edgeMetadata;

            return { tube, arrowHead, mat, container };
        },

        /**
         * Create a mesh for a node
         */
        createNodeMesh: function (nodePos, scene) {
            const pos = nodePos.position;
            const scale = nodePos.scale || { x: 1, y: 1, z: 1 };
            let mesh;

            switch (nodePos.shape) {
                case 'sphere':
                    mesh = BABYLON.MeshBuilder.CreateSphere(nodePos.node_id, { diameter: 1 }, scene);
                    break;
                case 'diamond':
                    mesh = BABYLON.MeshBuilder.CreatePolyhedron(nodePos.node_id, { type: 1, size: 0.6 }, scene);
                    break;
                case 'cylinder':
                    mesh = BABYLON.MeshBuilder.CreateCylinder(nodePos.node_id, { height: 1, diameter: 1, tessellation: 32 }, scene);
                    break;
                case 'hexagon':
                    mesh = BABYLON.MeshBuilder.CreateCylinder(nodePos.node_id, { height: 1, diameter: 1, tessellation: 6 }, scene);
                    break;
                default:
                    mesh = BABYLON.MeshBuilder.CreateBox(nodePos.node_id, { size: 1.5, height: 0.8 }, scene);
            }

            mesh.position = new BABYLON.Vector3(pos.x, pos.y, pos.z);
            mesh.scaling = new BABYLON.Vector3(scale.x, scale.y, scale.z);

            if (nodePos.rotation) {
                mesh.rotationQuaternion = new BABYLON.Quaternion(
                    nodePos.rotation.x,
                    nodePos.rotation.y,
                    nodePos.rotation.z,
                    nodePos.rotation.w
                );
            }

            // Create PBR material
            const mat = new BABYLON.PBRMaterial(nodePos.node_id + '_mat', scene);
            if (nodePos.material) {
                if (nodePos.material.diffuse_color) {
                    mat.albedoColor = this.hexToColor3(nodePos.material.diffuse_color);
                }
                if (nodePos.material.emissive_color) {
                    mat.emissiveColor = this.hexToColor3(nodePos.material.emissive_color);
                    mat.emissiveIntensity = 0.3;
                }
                mat.metallic = nodePos.material.metallic || 0.2;
                mat.roughness = nodePos.material.roughness || 0.5;
                mat.alpha = nodePos.material.alpha || 1.0;
                mat.transparencyMode = mat.alpha < 1.0 ? BABYLON.PBRMaterial.PBRMETHOD_BLEND : BABYLON.PBRMaterial.PBRMETHOD_OPAQUE;
            }
            mesh.material = mat;

            // Store metadata for picking
            const isBottleneck = nodePos.duration_ms && nodePos.bottleneck_threshold_ms && nodePos.duration_ms > nodePos.bottleneck_threshold_ms;
            if (isBottleneck) {
                mat.albedoColor = new BABYLON.Color3(1, 0.3, 0.3);
                mat.emissiveColor = new BABYLON.Color3(1, 0, 0);
                mat.emissiveIntensity = 0.6;
            }

            mesh.metadata = {
                type: 'node',
                id: nodePos.node_id,
                label: AWAViz.utils.nodeIdToLabel(nodePos.node_id),
                data: {
                    ...nodePos,
                    is_bottleneck: !!isBottleneck
                }
            };

            // Add hover effects
            mesh.actionManager = new BABYLON.ActionManager(scene);
            mesh.actionManager.registerAction(
                new BABYLON.ExecuteCodeAction(BABYLON.ActionManager.OnPointerOverTrigger, () => {
                    mat.emissiveIntensity = 0.6;
                })
            );
            mesh.actionManager.registerAction(
                new BABYLON.ExecuteCodeAction(BABYLON.ActionManager.OnPointerOutTrigger, () => {
                    mat.emissiveIntensity = 0.3;
                })
            );

            return mesh;
        },

        render: function (container, visualization, options) {
            if (!this.isAvailable()) {
                console.error('AWAViz: Babylon.js, React or ReactDOM not loaded');
                container.innerHTML = '<div style="padding: 20px; color: red;">Error: Babylon.js and React dependencies not loaded.</div>';
                return null;
            }

            const viz = visualization.visualization || visualization;
            const opts = AWAViz.utils.deepMerge({
                enableGlow: true,
                enableFog: false,
                enableGrid: true,
                autoAnimate: true
            }, options || {});

            // Create Canvas if not provided
            let canvas = container;
            if (!(container instanceof HTMLCanvasElement)) {
                canvas = document.createElement('canvas');
                canvas.style.width = '100%';
                canvas.style.height = '100%';
                canvas.style.outline = 'none';
                container.appendChild(canvas);
            }

            const engine = new BABYLON.Engine(canvas, true);
            const scene = new BABYLON.Scene(engine);

            // Interaction State
            let onSelectionChanged = () => { };

            // Background
            scene.clearColor = this.hexToColor3(viz.theme?.background_color || '#1A1A2E');

            // Fog
            if (opts.enableFog) {
                scene.fogMode = BABYLON.Scene.FOGMODE_EXP;
                scene.fogDensity = 0.015;
                scene.fogColor = scene.clearColor;
            }

            // Glow layer
            let glowLayer = null;
            if (opts.enableGlow) {
                glowLayer = new BABYLON.GlowLayer('glow', scene);
                glowLayer.intensity = 0.5;
            }

            // Camera
            const camConfig = viz.camera_3d || {};
            const camera = new BABYLON.ArcRotateCamera(
                'camera',
                camConfig.alpha || 1.2,
                camConfig.beta || 1.1,
                camConfig.radius || 25,
                new BABYLON.Vector3(
                    camConfig.target?.x || 0,
                    camConfig.target?.y || 0,
                    camConfig.target?.z || 0
                ),
                scene
            );
            camera.attachControl(canvas, true);
            camera.lowerRadiusLimit = 5;
            camera.upperRadiusLimit = 100;

            // Lighting
            const ambient = new BABYLON.HemisphericLight('ambient', new BABYLON.Vector3(0, 1, 0), scene);
            ambient.intensity = 0.5;

            const directional = new BABYLON.DirectionalLight('directional', new BABYLON.Vector3(-1, -2, -1), scene);
            directional.intensity = 0.8;

            // Maps for lookup
            const nodeMeshMap = new Map();
            const edgeMeshes = [];

            // Create nodes
            const nodePositions = viz.node_positions_3d || [];
            for (const nodePos of nodePositions) {
                const mesh = this.createNodeMesh(nodePos, scene);
                nodeMeshMap.set(nodePos.node_id, nodePos.position);
            }

            // Create edges
            const edges = viz.edge_routings || [];
            for (const edge of edges) {
                const source = nodeMeshMap.get(edge.source);
                const target = nodeMeshMap.get(edge.target);

                if (source && target) {
                    const edgeMesh = this.createEdgeMesh(source, target, edge, scene);
                    edgeMeshes.push(edgeMesh);
                }
            }

            // Selection / Interaction
            scene.onPointerDown = (evt, pickResult) => {
                if (pickResult.hit && pickResult.pickedMesh && pickResult.pickedMesh.metadata) {
                    const meta = pickResult.pickedMesh.metadata;
                    console.log(`[AWAViz] 3D Selected: ${meta.type} ${meta.id}`);

                    // Trigger callback for React UI
                    onSelectionChanged({
                        type: meta.type,
                        id: meta.id,
                        label: meta.label || meta.id,
                        data: meta.data,
                        position: { x: 0, y: 0 },
                        style: meta.data.style || {}
                    });
                } else if (!pickResult.hit) {
                    onSelectionChanged(null);
                }
            };

            // Grid floor
            if (opts.enableGrid && typeof BABYLON.GridMaterial !== 'undefined') {
                const gridMat = new BABYLON.GridMaterial('gridMat', scene);
                gridMat.majorUnitFrequency = 5;
                gridMat.minorUnitVisibility = 0.3;
                gridMat.gridRatio = viz.theme?.grid_size || 2;
                gridMat.mainColor = new BABYLON.Color3(0.05, 0.05, 0.1);
                gridMat.lineColor = this.hexToColor3(viz.theme?.grid_color || '#2D2D44');

                const ground = BABYLON.MeshBuilder.CreateGround('ground', { width: 100, height: 100 }, scene);
                ground.position.y = -5;
                ground.material = gridMat;
                ground.isPickable = false;
            }

            // Animation loop
            let time = 0;
            engine.runRenderLoop(() => {
                time += 0.016;
                if (opts.autoAnimate && viz.animation?.enabled) {
                    // Animate nodes (subtle bobbing)
                    scene.meshes.forEach((mesh) => {
                        if (mesh.metadata?.type === 'node') {
                            const offset = mesh.uniqueId % 10;
                            mesh.position.y = mesh.metadata.data.position.y + Math.sin(time * 2 + offset) * 0.05;
                        }
                    });

                    // Animate edges (pulsing intensity)
                    edgeMeshes.forEach((em) => {
                        if (em.mat) {
                            em.mat.emissiveIntensity = 0.2 + Math.sin(time * 4) * 0.1;
                        }
                    });
                }
                scene.render();
            });

            window.addEventListener('resize', () => engine.resize());

            // Render React UI Overlay
            const { createElement: h } = React;

            function UIOverlay() {
                const [selectedItem, setSelectedItem] = React.useState(null);
                const [activeTab, setActiveTab] = React.useState('details');
                const [analytics] = React.useState(() => AWAViz.utils.calculateWorkflowAnalytics(visualization));

                React.useEffect(() => {
                    onSelectionChanged = (item) => {
                        setSelectedItem(item);
                        if (item) setActiveTab('details');
                    };
                }, []);

                if (!selectedItem) return null;

                const closeDetails = () => setSelectedItem(null);

                return h('div', {
                    style: {
                        position: 'absolute',
                        top: '20px',
                        right: '20px',
                        width: '320px',
                        maxHeight: '80%',
                        overflowY: 'auto',
                        background: 'white',
                        borderRadius: '12px',
                        boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
                        zIndex: 1000,
                        fontFamily: "'Segoe UI', sans-serif",
                        pointerEvents: 'auto'
                    }
                }, [
                    // Workflow Summary (if nothing selected)
                    !selectedItem ? h('div', { style: { padding: '20px', background: '#f8f9fa', borderRadius: '12px' } }, [
                        h('div', { style: { fontSize: '14px', fontWeight: '700', color: '#333', marginBottom: '12px', display: 'flex', alignItems: 'center' } }, '📊 Workflow Analytics'),
                        h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' } }, [
                            h('div', { style: { background: 'white', padding: '10px', borderRadius: '8px', border: '1px solid #eee' } }, [
                                h('div', { style: { fontSize: '10px', color: '#888', textTransform: 'uppercase' } }, 'Total Duration'),
                                h('div', { style: { fontSize: '18px', fontWeight: '700', color: '#667eea' } }, analytics.totalDurationFormatted)
                            ]),
                            h('div', { style: { background: 'white', padding: '10px', borderRadius: '8px', border: '1px solid #eee' } }, [
                                h('div', { style: { fontSize: '10px', color: '#888', textTransform: 'uppercase' } }, 'Bottlenecks'),
                                h('div', { style: { fontSize: '18px', fontWeight: '700', color: analytics.bottleneckCount > 0 ? '#ff4d4f' : '#52c41a' } }, analytics.bottleneckCount)
                            ])
                        ])
                    ]) : [
                        // Header
                        h('div', {
                            style: {
                                background: selectedItem.type === 'node'
                                    ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
                                    : 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)',
                                color: 'white',
                                padding: '16px 20px',
                                borderRadius: '12px 12px 0 0',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center'
                            }
                        }, [
                            h('h3', { style: { margin: 0, fontSize: '16px', fontWeight: '600' } },
                                selectedItem.type === 'node' ? 'Activity Details' : 'Edge Details'),
                            h('button', {
                                onClick: closeDetails,
                                style: { background: 'rgba(255,255,255,0.2)', border: 'none', color: 'white', width: '28px', height: '28px', borderRadius: '50%', cursor: 'pointer', fontSize: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center' }
                            }, '×')
                        ]),
                        // Tabs
                        h('div', { style: { display: 'flex', borderBottom: '1px solid #e5e5e5', background: '#f9fafb' } }, [
                            h('button', {
                                onClick: () => setActiveTab('details'),
                                style: { flex: 1, padding: '12px', border: 'none', background: activeTab === 'details' ? 'white' : 'transparent', borderBottom: activeTab === 'details' ? '2px solid #667eea' : '2px solid transparent', color: activeTab === 'details' ? '#667eea' : '#64748b', cursor: 'pointer', fontWeight: activeTab === 'details' ? '600' : '400' }
                            }, 'Activity Data'),
                            h('button', {
                                onClick: () => setActiveTab('technical'),
                                style: { flex: 1, padding: '12px', border: 'none', background: activeTab === 'technical' ? 'white' : 'transparent', borderBottom: activeTab === 'technical' ? '2px solid #667eea' : '2px solid transparent', color: activeTab === 'technical' ? '#667eea' : '#64748b', cursor: 'pointer', fontWeight: activeTab === 'technical' ? '600' : '400' }
                            }, 'Visualization')
                        ]),
                        // Content
                        h('div', { style: { padding: '20px' } }, [
                            activeTab === 'details' ? [
                                h('div', { style: { marginBottom: '16px' } }, [
                                    h('div', { style: { fontSize: '12px', color: '#666', marginBottom: '4px' } }, 'Name'),
                                    h('div', { style: { fontSize: '15px', fontWeight: '600', color: '#333' } }, selectedItem.label)
                                ]),
                                // Metrics Section
                                (selectedItem.data.duration_ms || selectedItem.data.is_bottleneck) && h('div', { style: { marginBottom: '16px', background: selectedItem.data.is_bottleneck ? '#fff1f0' : '#f0f7ff', padding: '12px', borderRadius: '8px', border: `1px solid ${selectedItem.data.is_bottleneck ? '#ffa39e' : '#bae7ff'}` } }, [
                                    h('div', { style: { fontSize: '12px', color: selectedItem.data.is_bottleneck ? '#cf1322' : '#0050b3', fontWeight: '600', marginBottom: '8px' } }, selectedItem.type === 'node' ? '⏱️ Execution Metrics' : '🔄 Transfer & Flow'),
                                    selectedItem.data.transfer_type && h('div', { style: { marginBottom: '8px' } }, [
                                        h('div', { style: { fontSize: '10px', color: '#888' } }, 'Transfer Mode'),
                                        h('div', { style: { fontSize: '13px', fontWeight: '600', textTransform: 'capitalize' } }, selectedItem.data.transfer_type.replace(/_/g, ' '))
                                    ]),
                                    h('div', { style: { display: 'flex', justifyContent: 'space-between' } }, [
                                        h('div', {}, [
                                            h('div', { style: { fontSize: '10px', color: '#888' } }, selectedItem.type === 'node' ? 'Duration' : 'Transition Time'),
                                            h('div', { style: { fontSize: '14px', fontWeight: '700' } }, (selectedItem.data.duration_ms || 0) + 'ms')
                                        ]),
                                        selectedItem.data.is_bottleneck && h('div', { style: { textAlign: 'right' } }, [
                                            h('div', { style: { fontSize: '10px', color: '#cf1322' } }, 'Status'),
                                            h('div', { style: { fontSize: '12px', fontWeight: '700', color: '#cf1322' } }, '⚠️ BOTTLENECK')
                                        ])
                                    ])
                                ]),
                                selectedItem.data.description && h('div', { style: { marginBottom: '16px' } }, [
                                    h('div', { style: { fontSize: '12px', color: '#666', marginBottom: '4px' } }, 'Description'),
                                    h('div', { style: { fontSize: '13px', color: '#555', lineHeight: '1.5' } }, selectedItem.data.description)
                                ]),
                                selectedItem.data.procedure && h('div', { style: { marginBottom: '16px', borderTop: '1px solid #e5e5e5', paddingTop: '12px', marginTop: '4px' } }, [
                                    h('div', { style: { fontSize: '12px', color: '#666', marginBottom: '8px', fontWeight: '600' } }, '📋 Procedure'),
                                    h('div', {
                                        style: { fontSize: '13px', color: '#1a1a1a', lineHeight: '1.6', background: '#f8f9fa', padding: '12px', borderRadius: '6px', border: '1px solid #e5e5e5', whiteSpace: 'pre-wrap', fontFamily: 'monospace' }
                                    }, selectedItem.data.procedure)
                                ]),
                                // Additional Properties logic
                                (() => {
                                    const entries = Object.entries(selectedItem.data || {})
                                        .filter(([key]) => !['label', 'lane', 'procedure', 'description', 'position', 'scale', 'material', 'shape', 'node_id', 'node_type', 'duration_ms', 'bottleneck_threshold_ms', 'is_bottleneck', 'transfer_type'].includes(key));
                                    if (entries.length === 0) return null;
                                    return h('div', { style: { marginTop: '16px', borderTop: '1px solid #e5e5e5', paddingTop: '12px' } }, [
                                        h('div', { style: { fontSize: '12px', color: '#666', marginBottom: '8px', fontWeight: '600' } }, 'Additional Properties'),
                                        ...entries.map(([key, value]) => h('div', { style: { marginBottom: '8px' } }, [
                                            h('div', { style: { fontSize: '11px', color: '#888', textTransform: 'capitalize' } }, key.replace(/_/g, ' ')),
                                            h('div', { style: { fontSize: '13px', color: '#333', wordBreak: 'break-word' } }, typeof value === 'object' ? JSON.stringify(value) : String(value))
                                        ]))
                                    ]);
                                })()
                            ] : [
                                h('div', { style: { marginBottom: '16px' } }, [
                                    h('div', { style: { fontSize: '12px', color: '#666', marginBottom: '4px' } }, '3D Position'),
                                    h('div', { style: { fontSize: '13px', color: '#333', fontFamily: 'monospace' } },
                                        selectedItem.type === 'node'
                                            ? `X: ${selectedItem.data.position?.x}, Y: ${selectedItem.data.position?.y}, Z: ${selectedItem.data.position?.z}`
                                            : `Source: ${selectedItem.data.source} → Target: ${selectedItem.data.target}`)
                                ]),
                                h('div', { style: { marginBottom: '0' } }, [
                                    h('div', { style: { fontSize: '12px', color: '#666', marginBottom: '4px' } }, 'Geometry Attributes'),
                                    h('div', { style: { fontSize: '13px', color: '#333', lineHeight: '1.6' } }, [
                                        h('div', {}, `Shape: ${selectedItem.data.shape || (selectedItem.type === 'edge' ? 'Tube' : 'Box')}`),
                                        selectedItem.data.material && h('div', {}, `Color: ${selectedItem.data.material.diffuse_color || '#fff'}`)
                                    ])
                                ])
                            ]
                        ])
                    ]
                ]);
            }

            // UI Overlay root
            const uiDiv = document.createElement('div');
            uiDiv.id = 'awa-viz-3d-ui-' + Math.random().toString(36).substr(2, 9);
            uiDiv.style.position = 'absolute';
            uiDiv.style.top = '0';
            uiDiv.style.left = '0';
            uiDiv.style.width = '100%';
            uiDiv.style.height = '100%';
            uiDiv.style.pointerEvents = 'none';
            uiDiv.style.zIndex = '1000';

            // If container is canvas, append to parent
            const targetParent = (container instanceof HTMLCanvasElement) ? container.parentElement : container;
            if (targetParent) {
                if (getComputedStyle(targetParent).position === 'static') {
                    targetParent.style.position = 'relative';
                }
                targetParent.appendChild(uiDiv);
            }

            // Store engine for unmounting
            container._awaEngine = engine;

            AWAViz.utils.reactRender(h(UIOverlay), uiDiv);

            return { engine, scene, camera, meshes: scene.meshes, uiDiv };
        }
    };

    // ============================================================================
    // MAIN API
    // ============================================================================

    /**
     * Auto-detect and render visualization
     */
    AWAViz.render = function (container, visualization, options) {
        const viz = visualization.visualization || visualization;
        const viewType = viz.view_type || '2d';

        if (viewType === '3d') {
            // For 3D, container should be a canvas element
            let canvas = container;
            if (!(container instanceof HTMLCanvasElement)) {
                canvas = document.createElement('canvas');
                canvas.style.width = '100%';
                canvas.style.height = '100%';
                container.appendChild(canvas);
            }
            return this.renderers.Babylon3D.render(canvas, visualization, options);
        } else {
            return this.renderers.ReactFlow2D.render(container, visualization, options);
        }
    };

    /**
     * Create a complete visualization page with header and controls
     */
    AWAViz.createPage = function (container, visualization, options) {
        const viz = visualization.visualization || visualization;
        const opts = AWAViz.utils.deepMerge({
            showHeader: true,
            showControls: true,
            headerGradient: viz.view_type === '3d'
                ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
                : 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)'
        }, options || {});

        // Create layout
        container.style.display = 'flex';
        container.style.flexDirection = 'column';
        container.style.height = '100%';
        container.style.fontFamily = "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif";

        // Header
        if (opts.showHeader) {
            const header = AWAViz.utils.createElement('div', {
                style: {
                    background: opts.headerGradient,
                    padding: '15px 20px',
                    color: 'white',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                }
            });

            const title = AWAViz.utils.createElement('div', {}, [
                AWAViz.utils.createElement('h1', {
                    style: { fontSize: '1.3rem', fontWeight: '600', margin: '0' }
                }, viz.name || 'AWA Workflow Visualization'),
                AWAViz.utils.createElement('p', {
                    style: { fontSize: '0.85rem', opacity: '0.9', margin: '5px 0 0' }
                }, viz.description || '')
            ]);

            header.appendChild(title);
            container.appendChild(header);
        }

        // Visualization container
        const vizContainer = AWAViz.utils.createElement('div', {
            style: {
                flex: '1',
                position: 'relative',
                overflow: 'hidden'
            }
        });
        container.appendChild(vizContainer);

        // Render
        return this.render(vizContainer, visualization, options);
    };

    // Export to global
    global.AWAViz = AWAViz;

})(typeof window !== 'undefined' ? window : this);
