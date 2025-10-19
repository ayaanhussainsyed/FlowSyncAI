const statusMessage = document.getElementById('statusMessage');
const loadingSpinner = document.getElementById('loadingSpinner');
const networkCanvas = document.getElementById('network-canvas');

let allNotes = [];
let network = null;
let nodes = new vis.DataSet();
let edges = new vis.DataSet();
let data = { nodes: nodes, edges: edges };

// Define a palette of distinct colors for notes
const noteColors = [
    '#FF6347', // Tomato
    '#4682B4', // SteelBlue
    '#3CB371', // MediumSeaGreen
    '#FFD700', // Gold
    '#9370DB', // MediumPurple
    '#FFA07A', // LightSalmon
    '#20B2AA', // LightSeaGreen
    '#DA70D6', // Orchid
    '#87CEEB', // SkyBlue
    '#CD5C5C', // IndianRed
    '#6A5ACD', // SlateBlue
    '#FF69B4'  // HotPink
];

let options = {
    autoResize: true,
    height: '100%',
    width: '100%',
    layout: {
        hierarchical: {
            enabled: false
        }
    },
    nodes: {
        shape: 'box', // All notes are boxes by default, can be overridden
        size: 20,
        font: {
            size: 14,
            color: 'white', // Default node text color white
            strokeWidth: 0,
            align: 'center'
        },
        borderWidth: 2,
        color: {
            highlight: {
                border: '#888',
                background: '#333'
            },
            hover: {
                border: '#888',
                background: '#333'
            }
        },
        shadow: true
    },
    edges: {
        width: 1,
        color: {
            color: 'black', // Edges are black
            highlight: '#555',
            hover: '#555',
            inherit: false,
            opacity: 0.8
        },
        smooth: {
            enabled: true,
            type: 'continuous'
        },
        shadow: true
    },
    physics: {
        enabled: true,
        barnesHut: {
            gravitationalConstant: -2000, // Reduced repulsion, nodes group more
            centralGravity: 0.1, // Slight central gravity to keep clusters together
            springLength: 150, // Shorter springs for tighter clusters
            springConstant: 0.01, // Stronger springs
            damping: 0.9,
            avoidOverlap: 0.5 // Allow some overlap for denser clusters
        },
        minVelocity: 0.75,
        solver: 'barnesHut',
        stabilization: {
            enabled: true,
            iterations: 1000,
            updateInterval: 25,
            fit: true
        }
    },
    interaction: {
        navigationButtons: true,
        keyboard: true,
        zoomView: true,
        dragNodes: true,
        dragView: true
    },
};

function showMessage(message, type) {
    statusMessage.textContent = message;
    statusMessage.className = `message ${type}`;
    statusMessage.style.display = 'block';
    setTimeout(() => {
        statusMessage.style.display = 'none';
    }, 8000);
}

function showLoading(show) {
    loadingSpinner.style.display = show ? 'block' : 'none';
}

async function fetchAndProcessNotes() {
    showLoading(true);
    showMessage('Fetching notes...', 'info');
    try {
        // 1. Fetch all user notes
        const notesResponse = await fetch('/get_user_notes');
        if (!notesResponse.ok) {
            throw new Error(`HTTP error! status: ${notesResponse.status}`);
        }
        allNotes = await notesResponse.json();

        if (allNotes.length === 0) {
            showMessage('No notes found. Create some notes to see the semantic map.', 'info');
            showLoading(false);
            return;
        }

        // 2. Generate embeddings for any notes missing them
        let notesToEmbed = allNotes.filter(note => !note.embedding);
        if (notesToEmbed.length > 0) {
            showMessage(`Generating embeddings for ${notesToEmbed.length} notes... This might take a while.`, 'info');
            for (const note of notesToEmbed) {
                try {
                    const textToEmbed = note.summary || note.transcript || note.title;
                    if (!textToEmbed) {
                        console.warn(`Note ${note._id} has no content to embed.`);
                        continue;
                    }
                    const embedResponse = await fetch('/generate_embedding', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ text: textToEmbed, note_id: note._id })
                    });
                    if (!embedResponse.ok) {
                        throw new Error(`HTTP error! status: ${embedResponse.status}`);
                    }
                    const result = await embedResponse.json();
                    // Update the note object in our local 'allNotes' array
                    const index = allNotes.findIndex(n => n._id === note._id);
                    if (index !== -1) {
                        allNotes[index].embedding = result.embedding;
                    }
                } catch (error) {
                    console.error(`Error generating embedding for note ${note._id}:`, error);
                    showMessage(`Failed to generate embedding for some notes. Check console for details.`, 'error');
                }
            }
            showMessage('Embeddings generation complete.', 'success');
        } else {
            showMessage('All notes already have embeddings.', 'info');
        }

        // Filter for notes that successfully have embeddings now
        const embeddedNotes = allNotes.filter(note => note.embedding);

        if (embeddedNotes.length === 0) {
            showMessage('No notes with embeddings available to form a map. Please ensure notes have content for embedding generation.', 'info');
            showLoading(false);
            return;
        }

        nodes.clear();
        edges.clear();

        const uniqueTags = new Set();
        const tagNodeIds = {}; // Maps tag name to node ID
        let tagColorIndex = 0;

        // Add all notes as box nodes
        embeddedNotes.forEach((note, index) => {
            const nodeColor = noteColors[index % noteColors.length]; // Cycle through colors
            nodes.add({
                id: note._id,
                label: note.title || 'Untitled Note',
                title: note.summary || 'No summary.', // Tooltip on hover
                shape: 'box',
                color: {
                    background: nodeColor,
                    border: nodeColor
                },
                font: {
                    color: 'white',
                    size: 14,
                    face: 'Arial',
                    background: 'transparent'
                },
                widthConstraint: { maximum: 180 },
                shadow: true
            });

            // Collect unique tags and create tag nodes
            if (note.tags && note.tags.length > 0) {
                note.tags.forEach(tag => {
                    if (!uniqueTags.has(tag)) {
                        uniqueTags.add(tag);
                        const tagNodeId = `tag_${tag.replace(/\s+/g, '_').toLowerCase()}`;
                        tagNodeIds[tag] = tagNodeId;
                        nodes.add({
                            id: tagNodeId,
                            label: tag,
                            shape: 'circle', // Tag nodes are circles
                            color: {
                                background: 'black', // Black background for tags
                                border: 'black'
                            },
                            font: {
                                color: 'white', // White text for tags
                                size: 16,
                                face: 'Arial',
                                background: 'transparent'
                            },
                            size: 30, // Slightly smaller than central topic, larger than notes
                            shadow: true,
                        });
                    }
                    // Connect note to its tag node
                    edges.add({ from: tagNodeIds[tag], to: note._id, color: 'black' });
                });
            } else {
                // Handle notes without tags: connect to a generic 'Untagged' node
                const untaggedNodeId = 'untagged_notes';
                if (!nodes.get(untaggedNodeId)) {
                    nodes.add({
                        id: untaggedNodeId,
                        label: 'Untagged Notes',
                        shape: 'circle',
                        color: {
                            background: '#B0C4DE', // Light steel blue
                            border: '#778899' // Light slate grey
                        },
                        font: {
                            color: 'black',
                            size: 16,
                            face: 'Arial',
                            background: 'transparent'
                        },
                        size: 30,
                        shadow: true,
                    });
                }
                edges.add({ from: untaggedNodeId, to: note._id, color: 'black' });
            }
        });


        // Initialize the network
        if (!network) {
            network = new vis.Network(networkCanvas, data, options);
        } else {
            network.setData(data);
        }

        network.once("stabilizationIterationsDone", function() {
            network.fit();
        });
        network.stabilize();

        showMessage('Semantic map loaded! Notes are grouped by tags. You can drag nodes and pan/zoom the graph.', 'success');

    } catch (error) {
        console.error("Error building semantic map:", error);
        showMessage(`Failed to build semantic map: ${error.message}. Please check console for details.`, 'error');
    } finally {
        showLoading(false);
    }
}

// Initial load and processing
document.addEventListener('DOMContentLoaded', fetchAndProcessNotes);