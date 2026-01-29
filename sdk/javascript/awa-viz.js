/**
 * AWA Visualization Library
 * A unified library for rendering AWA workflows in 2D (ReactFlow) and 3D (Babylon.js)
 * 
 * @version 1.0.0
 * @license Apache-2.0
 */

(function (global) {
    'use strict';

    // ============================================================================
    // AWA VISUALIZATION NAMESPACE
    // ============================================================================

    const AWAViz = {
        version: '1.0.0',
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
            return typeof React !== 'undefined' &&
                typeof ReactDOM !== 'undefined' &&
                (typeof window.xyflowReact !== 'undefined' || typeof window.ReactFlow !== 'undefined');
        },

        /**
         * Convert AWA visualization config to ReactFlow format
         */
        convertToReactFlow: function (visualization, containerHeight) {
            const viz = visualization.visualization || visualization;

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

                return {
                    id: pos.node_id,
                    type: 'default',
                    position: { x: pos.position.x, y: yPosition },
                    data: {
                        label: AWAViz.utils.nodeIdToLabel(pos.node_id),
                        lane: pos.lane,
                        // Include all other fields from position config
                        ...Object.fromEntries(
                            Object.entries(pos).filter(([key]) =>
                                !['node_id', 'position', 'width', 'height', 'style', 'lane', 'node_type', 'id'].includes(key)
                            )
                        )
                    },
                    style: {
                        backgroundColor: pos.style?.background_color || '#ffffff',
                        borderColor: pos.style?.border_color || '#333333',
                        borderWidth: pos.style?.border_width || 1,
                        borderRadius: pos.node_type === 'decision' ? 0 : (pos.style?.border_radius || 8),
                        borderStyle: 'solid',
                        width: pos.width || 150,
                        height: nodeHeight,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '11px',
                        fontWeight: '500',
                        padding: '8px'
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

                return {
                    id: route.edge_id,
                    source: sourceNode?.id || source,
                    target: targetNode?.id || target,
                    type: route.curve_type === 'smoothstep' ? 'smoothstep' :
                        route.curve_type === 'step' ? 'step' : 'default',
                    animated: route.animated || false,
                    label: route.label || '',
                    markerEnd: {
                        type: 'arrowclosed',
                        width: 20,
                        height: 20,
                        color: route.style?.stroke_color || '#666666'
                    },
                    style: {
                        stroke: route.style?.stroke_color || '#666666',
                        strokeWidth: route.style?.stroke_width || 2
                    }
                };
            });

            return { nodes, edges, config: viz, laneMap };
        },

        /**
         * Render visualization to container
         */
        render: function (container, visualization, options) {
            if (!this.isAvailable()) {
                console.error('AWAViz: ReactFlow dependencies not loaded');
                container.innerHTML = '<div style="padding: 20px; color: red;">Error: ReactFlow dependencies not loaded. Please include React, ReactDOM, and @xyflow/react.</div>';
                return null;
            }

            const opts = AWAViz.utils.deepMerge({
                fitView: false,
                showMinimap: true,
                showControls: true,
                showBackground: true,
                containerHeight: null  // Can be passed explicitly
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
                const [activeTab, setActiveTab] = React.useState('details'); // 'details' or 'technical'

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
                        style: edge.style
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
                        fitView: false,
                        defaultViewport: { x: 0, y: 0, zoom: 1 },
                        translateExtent: [[0, 0], [containerWidth, containerHeight]],
                        minZoom: 0.5,
                        maxZoom: 2.0,
                        panOnScroll: true,
                        preventScrolling: true,
                        style: {
                            background: 'transparent',
                            width: '100%',
                            height: '100%'
                        }
                    },
                        opts.showBackground && h(RF.Background, {
                            color: config.theme?.grid_color || '#e0e0e0',
                            gap: config.theme?.grid_size || 20
                        }),
                        opts.showControls && h(RF.Controls, {}),
                        opts.showMinimap && h(RF.MiniMap, {
                            nodeColor: '#667eea',
                            maskColor: 'rgba(0,0,0,0.1)'
                        })
                    ),
                    // Details panel
                    selectedItem && h('div', {
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
                                // Display ALL additional data fields
                                // Display other additional data fields
                                Object.keys(selectedItem.data || {}).filter(key => !['label', 'lane', 'procedure'].includes(key)).length > 0 &&
                                    h('div', { style: { fontSize: '12px', color: '#666', marginBottom: '8px', fontWeight: '600' } }, 'Additional Properties'),
                                    ...Object.entries(selectedItem.data || {})
                                        .filter(([key]) => !['label', 'lane'].includes(key))
                                        .filter(([key]) => !['label', 'lane', 'procedure'].includes(key))
                                            h('div', { style: { marginBottom: '8px' } }, [
                                                h('div', { style: { fontSize: '11px', color: '#888', marginBottom: '2px', textTransform: 'capitalize' } }, key.replace(/_/g, ' ')),
                                                h('div', { style: { fontSize: '13px', color: '#333', wordBreak: 'break-word' } },
                                                    typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value))
                                            ])
                                        )
                                ]),
                                // Visualization Tab
                                activeTab === 'technical' && [
                                    h('div', { style: { marginBottom: '16px' } }, [
                                        h('div', { style: { fontSize: '12px', color: '#666', marginBottom: '4px' } }, 'Position'),
                                        h('div', { style: { fontSize: '13px', color: '#555' } },
                                            `X: ${Math.round(selectedItem.position.x)}, Y: ${Math.round(selectedItem.position.y)}`)
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
                                // Edge Details Tab
                                activeTab === 'details' && [
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
                                    selectedItem.label && h('div', { style: { marginBottom: '0' } }, [
                                        h('div', { style: { fontSize: '12px', color: '#666', marginBottom: '4px' } }, 'Label'),
                                        h('div', { style: { fontSize: '14px', color: '#555', fontWeight: '500' } }, selectedItem.label)
                                    ])
                                ],
                                // Edge Visualization Tab
                                activeTab === 'technical' && [
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
                    ])
                ]);
            }

            console.log(`[AWAViz] ReactFlow viewport: ${containerWidth}x${containerHeight}px, zoom=1.0 (1:1 with lanes)`);

            // Use React 17 render API (not React 18's createRoot)
            ReactDOM.render(h(App), container);

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
            return typeof BABYLON !== 'undefined';
        },

        /**
         * Convert hex to Babylon Color3
         */
        hexToColor3: function (hex) {
            const rgb = AWAViz.utils.hexToRgb(hex);
            return rgb ? new BABYLON.Color3(rgb.r, rgb.g, rgb.b) : new BABYLON.Color3(0.5, 0.5, 0.5);
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
                    mesh = BABYLON.MeshBuilder.CreateBox(nodePos.node_id, { size: 1 }, scene);
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
            }
            mesh.material = mat;

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

        /**
         * Render visualization to canvas
         */
        render: function (canvas, visualization, options) {
            if (!this.isAvailable()) {
                console.error('AWAViz: Babylon.js not loaded');
                return null;
            }

            const viz = visualization.visualization || visualization;
            const opts = AWAViz.utils.deepMerge({
                enableGlow: true,
                enableFog: false,
                enableGrid: true,
                autoAnimate: true
            }, options || {});

            const engine = new BABYLON.Engine(canvas, true);
            const scene = new BABYLON.Scene(engine);

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
            camera.lowerRadiusLimit = 10;
            camera.upperRadiusLimit = 60;

            // Lighting
            const ambient = new BABYLON.HemisphericLight('ambient', new BABYLON.Vector3(0, 1, 0), scene);
            ambient.intensity = 0.4;

            const directional = new BABYLON.DirectionalLight('directional', new BABYLON.Vector3(-1, -2, -1), scene);
            directional.intensity = 0.8;

            // Create nodes
            const meshes = [];
            const nodePositions = viz.node_positions_3d || [];
            for (const nodePos of nodePositions) {
                const mesh = this.createNodeMesh(nodePos, scene);
                meshes.push(mesh);
            }

            // Grid floor
            if (opts.enableGrid && typeof BABYLON.GridMaterial !== 'undefined') {
                const gridMat = new BABYLON.GridMaterial('gridMat', scene);
                gridMat.majorUnitFrequency = 5;
                gridMat.minorUnitVisibility = 0.3;
                gridMat.gridRatio = viz.theme?.grid_size || 2;
                gridMat.mainColor = new BABYLON.Color3(0.1, 0.1, 0.15);
                gridMat.lineColor = this.hexToColor3(viz.theme?.grid_color || '#2D2D44');

                const ground = BABYLON.MeshBuilder.CreateGround('ground', { width: 50, height: 50 }, scene);
                ground.position.y = -5;
                ground.material = gridMat;
            }

            // Animation loop
            let time = 0;
            engine.runRenderLoop(() => {
                time += 0.016;
                if (opts.autoAnimate && viz.animation?.enabled) {
                    meshes.forEach((mesh, i) => {
                        mesh.position.y += Math.sin(time * 2 + i) * 0.001;
                    });
                }
                scene.render();
            });

            window.addEventListener('resize', () => engine.resize());

            return { engine, scene, camera, meshes };
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
