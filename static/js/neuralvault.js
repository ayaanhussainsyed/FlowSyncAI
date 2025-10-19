const searchInput = document.getElementById('searchInput');
const searchLoading = document.getElementById('searchLoading');
const searchResultsDiv = document.getElementById('searchResultsDiv');
const welcomeMessage = document.getElementById('welcomeMessage');
const categoryFilter = document.getElementById('categoryFilter'); // New: Category Filter

const sidebarSearchInput = document.getElementById('sidebarSearchInput');
const notesList = document.getElementById('notesList');
const addNewNoteButton = document.getElementById('addNewNoteButton');

const introSection = document.getElementById('introSection');
const noteDetailView = document.getElementById('noteDetailView');
const backToSearchButton = document.getElementById('backToSearchButton');

const noteDetailTitle = document.getElementById('noteDetailTitle');
const noteDetailTimestamp = document.getElementById('noteDetailTimestamp');
const noteDetailSummary = document.getElementById('noteDetailSummary');
const noteDetailTranscript = document.getElementById('noteDetailTranscript');
const noteDetailTags = document.getElementById('noteDetailTags');
const noteDetailTasks = document.getElementById('noteDetailTasks').querySelector('ul');
const noteDetailAudio = document.getElementById('noteDetailAudio'); // UNCOMMENTED

const formattingToolbar = document.getElementById('formattingToolbar');
const saveChangesButton = document.getElementById('saveChangesButton');

let currentNoteId = null; 
let originalNoteContent = {}; 
let hasUnsavedChanges = false; 

// --- Utility Functions ---
function formatDate(isoString) {
    const date = new Date(isoString);
    return date.toLocaleString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function setHasUnsavedChanges(changed) {
    hasUnsavedChanges = changed;
    saveChangesButton.disabled = !changed;
}

function trackContentChanges() {
    const titleChanged = noteDetailTitle.innerHTML !== originalNoteContent.title;
    const summaryChanged = noteDetailSummary.innerHTML !== originalNoteContent.summary;
    const transcriptChanged = noteDetailTranscript.innerHTML !== originalNoteContent.transcript;
    let tasksChanged = false;
    const currentTasks = [];
    document.querySelectorAll('#noteDetailTasks ul li').forEach(li => {
        const checkbox = li.querySelector('input[type="checkbox"]');
        const label = li.querySelector('label');
        if (checkbox && label) {
            currentTasks.push({
                task: label.textContent,
                completed: checkbox.checked
            });
        }
    });

    if (currentTasks.length !== originalNoteContent.detected_tasks.length) {
        tasksChanged = true;
    } else {
        for (let i = 0; i < currentTasks.length; i++) {
            // Compare both task text and completion status
            if (currentTasks[i].task !== originalNoteContent.detected_tasks[i].task ||
                currentTasks[i].completed !== originalNoteContent.detected_tasks[i].completed) {
                tasksChanged = true;
                break;
            }
        }
    }
    setHasUnsavedChanges(titleChanged || summaryChanged || transcriptChanged || tasksChanged);
}
noteDetailTitle.addEventListener('input', trackContentChanges);
noteDetailSummary.addEventListener('input', trackContentChanges);
noteDetailTranscript.addEventListener('input', trackContentChanges);

async function fetchNotesForSidebar() {
    notesList.innerHTML = '<li class="loading-notes-sidebar">Loading notes...</li>';
    try {
        const response = await fetch('/get_user_notes');
        const data = await response.json(); // Data is directly the array of notes

        if (response.ok) {
            notesList.innerHTML = ''; 
            if (data.length > 0) { // Check if the array has elements
                data.forEach(note => {
                    const listItem = document.createElement('li');
                    const link = document.createElement('a');
                    link.href = '#';
                    link.dataset.noteId = note._id; // Use note._id
                    link.innerHTML = `<span class="sidebar-icon">📄</span> ${note.title}`;
                    link.addEventListener('click', (e) => {
                        e.preventDefault();
                        loadNoteDetails(note._id); // Use note._id
                        // Remove 'active' from all, add to clicked
                        document.querySelectorAll('#notesList a').forEach(a => a.classList.remove('active'));
                        link.classList.add('active');
                    });
                    listItem.appendChild(link);
                    notesList.appendChild(listItem);
                });
            } else {
                notesList.innerHTML = '<li class="no-notes-sidebar">No notes yet.</li>';
            }
        } else {
            console.error('Error fetching notes:', data.error);
            notesList.innerHTML = '<li class="no-notes-sidebar">Error loading notes.</li>';
        }
    } catch (error) {
        console.error('Network error fetching notes:', error);
        notesList.innerHTML = '<li class="no-notes-sidebar">Network error.</li>';
    }
}

// --- Note Detail View ---
async function loadNoteDetails(noteId) {
    introSection.style.display = 'none';
    searchResultsDiv.innerHTML = ''; // Clear search results when viewing a note
    welcomeMessage.style.display = 'none'; // Hide welcome message
    noteDetailView.style.display = 'block'; // Show note detail view
    formattingToolbar.style.display = 'flex'; // Show toolbar
    setHasUnsavedChanges(false); // No changes yet when loading

    currentNoteId = noteId; // Set the current note ID

    noteDetailTitle.innerHTML = 'Loading...';
    noteDetailSummary.innerHTML = 'Loading...';
    noteDetailTranscript.innerHTML = 'Loading...';
    noteDetailTimestamp.textContent = '';
    noteDetailTags.innerHTML = '';
    noteDetailTasks.innerHTML = '';
    noteDetailAudio.src = ''; // Clear previous audio
    noteDetailAudio.style.display = 'none'; // Hide by default until audio is found

    try {
        const response = await fetch(`/get_note_details/${noteId}`);
        const data = await response.json();

        if (response.ok && data.note) {
            const note = data.note;
            noteDetailTitle.innerHTML = note.title || 'Untitled Note';
            noteDetailTimestamp.textContent = `Created: ${formatDate(note.timestamp.$date)}`; // Assuming $date from MongoDB
            noteDetailSummary.innerHTML = note.summary || 'No summary available.';
            noteDetailTranscript.innerHTML = note.transcript || 'No transcript available.';

            // Store original content, including tasks for comparison
            originalNoteContent = {
                title: noteDetailTitle.innerHTML,
                summary: noteDetailSummary.innerHTML,
                transcript: noteDetailTranscript.innerHTML,
                detected_tasks: JSON.parse(JSON.stringify(note.detected_tasks || [])) // Deep copy tasks
            };


            // Tags
            noteDetailTags.innerHTML = '';
            if (note.tags && note.tags.length > 0) {
                note.tags.forEach(tag => {
                    const tagSpan = document.createElement('span');
                    tagSpan.className = 'tag-item';
                    tagSpan.textContent = tag;
                    noteDetailTags.appendChild(tagSpan);
                });
            } else {
                noteDetailTags.textContent = 'No tags.';
            }

            // Tasks - Modified to handle 'completed' status and string/object types
            noteDetailTasks.innerHTML = '';
            if (note.detected_tasks && note.detected_tasks.length > 0) {
                note.detected_tasks.forEach((taskItem, index) => {
                    const listItem = document.createElement('li');
                    const checkboxId = `task-${noteId}-${index}`;
                    
                    // taskItem is now expected to be an object: {task: "...", completed: bool}
                    const taskText = taskItem.task;
                    const isCompleted = taskItem.completed ? 'checked' : '';

                    listItem.innerHTML = `
                        <input type="checkbox" id="${checkboxId}" ${isCompleted}>
                        <label for="${checkboxId}">${taskText}</label>
                    `;
                    noteDetailTasks.appendChild(listItem);

                    // Add event listener to checkbox for tracking changes
                    listItem.querySelector('input[type="checkbox"]').addEventListener('change', trackContentChanges);
                });
            } else {
                noteDetailTasks.textContent = 'No tasks detected.';
            }

            // Audio (UNCOMMENTED AND CORRECTED)
            if (note.audio_base64) {
                // Assuming the audio type is webm, adjust if needed (e.g., mp3)
                noteDetailAudio.src = `data:audio/webm;base64,${note.audio_base64}`;
                noteDetailAudio.style.display = 'block';
            } else {
                noteDetailAudio.style.display = 'none';
            }

        } else {
            noteDetailTitle.innerHTML = 'Error Loading Note';
            noteDetailSummary.innerHTML = data.error || 'Could not load note details.';
            noteDetailTranscript.innerHTML = '';
            noteDetailTimestamp.textContent = '';
            noteDetailTags.innerHTML = '';
            noteDetailTasks.innerHTML = '';
            noteDetailAudio.src = '';
            noteDetailAudio.style.display = 'none';
            console.error('Failed to load note details:', data.error);
        }
    } catch (error) {
        console.error('Network error loading note details:', error);
        noteDetailTitle.innerHTML = 'Network Error';
        noteDetailSummary.innerHTML = 'Could not connect to the server.';
        noteDetailTranscript.innerHTML = '';
        noteDetailTimestamp.textContent = '';
        noteDetailTags.innerHTML = '';
        noteDetailTasks.innerHTML = '';
        noteDetailAudio.src = '';
        noteDetailAudio.style.display = 'none';
    }
}

backToSearchButton.addEventListener('click', () => {
    noteDetailView.style.display = 'none';
    formattingToolbar.style.display = 'none'; // Hide toolbar when going back
    introSection.style.display = 'flex'; // Show search/intro
    welcomeMessage.style.display = 'block'; // Ensure welcome message is visible
    setHasUnsavedChanges(false); // Reset changes flag
});

// --- Formatting Toolbar ---
formattingToolbar.addEventListener('click', (event) => {
    const button = event.target.closest('.toolbar-button');
    if (button) {
        const command = button.dataset.command;
        if (command) {
            document.execCommand(command, false, null);
            // Ensure focus remains on the edited content for continued typing
            const activeElement = document.activeElement;
            if (activeElement && (activeElement === noteDetailTitle || activeElement === noteDetailSummary || activeElement === noteDetailTranscript)) {
                // Restore selection after execCommand, as it can sometimes lose it
                const selection = window.getSelection();
                if (selection.rangeCount > 0) {
                    const range = selection.getRangeAt(0);
                    selection.removeAllRanges();
                    selection.addRange(range);
                }
            }
        }
    }
});

// --- Save Changes Button (for existing notes) ---
saveChangesButton.addEventListener('click', async () => {
    if (!currentNoteId) {
        alert("No note selected to save. Use 'Save New Note' if you're creating one from scratch after adding content manually.");
        return;
    }

    // Collect current state of tasks
    const updatedTasks = [];
    document.querySelectorAll('#noteDetailTasks ul li').forEach(li => {
        const checkbox = li.querySelector('input[type="checkbox"]');
        const label = li.querySelector('label');
        if (checkbox && label) {
            updatedTasks.push({
                task: label.textContent,
                completed: checkbox.checked
            });
        }
    });

    const updatedNoteData = {
        noteId: currentNoteId,
        title: noteDetailTitle.innerHTML,
        summary: noteDetailSummary.innerHTML,
        transcript: noteDetailTranscript.innerHTML,
        detected_tasks: updatedTasks // Include the updated tasks (now objects)
    };

    try {
        const response = await fetch('/update_note', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(updatedNoteData),
        });
        const data = await response.json();

        if (response.ok) {
            alert(data.message || 'Changes saved successfully!');
            setHasUnsavedChanges(false); // Reset changes flag after successful save
            // Update original content to reflect saved state, including tasks
            originalNoteContent = {
                title: noteDetailTitle.innerHTML,
                summary: noteDetailSummary.innerHTML,
                transcript: noteDetailTranscript.innerHTML,
                detected_tasks: JSON.parse(JSON.stringify(updatedTasks)) // Deep copy to prevent reference issues
            };
            fetchNotesForSidebar(); // Refresh sidebar in case title changed
        } else {
            alert('Failed to save changes: ' + (data.error || 'Unknown error.'));
            console.error('Error saving changes:', data.error);
        }
    } catch (error) {
        console.error('Network error saving changes:', error);
        alert('An error occurred while saving changes.');
    }
});

// --- Save New Note Logic (This is for the initial saving of a new transcription) ---
// This function would be called when you have a new AI-generated transcript/summary
// and want to save it as a new note.
// MODIFIED: Added audioBase64 parameter
async function saveNewTranscribedNote(title, transcript, summary, tags, detectedTasks, audioBase64) {
     const noteData = {
        title: title,
        transcript: transcript,
        summary: summary,
        tags: tags,
        // Ensure initial tasks are stored as objects {task: "...", completed: false}
        detected_tasks: detectedTasks.map(task => ({task: task, completed: false})),
        audio_base64: audioBase64 // ADDED AUDIO BASE64
    };

    try {
        const response = await fetch('/save_note', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(noteData),
        });
        const data = await response.json();

        if (response.ok) {
            alert(data.message || 'New note saved successfully!');
            fetchNotesForSidebar(); // Refresh sidebar
            // Optionally load the new note details
            // if (data.noteId) loadNoteDetails(data.noteId);
            
            // NEW: Call generate_embedding if noteId is available and transcript is present
            if (data.noteId && transcript) {
                const embeddingResponse = await fetch('/generate_embedding', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ note_id: data.noteId, text: transcript })
                });
                const embeddingData = await embeddingResponse.json();
                if (embeddingResponse.ok) {
                    console.log('Embedding generated and saved for new note:', data.noteId);
                } else {
                    console.error('Error generating embedding for new note:', embeddingData.error);
                }
            }

        } else {
            alert('Failed to save new note: ' + (data.error || 'Unknown error.'));
            console.error('Error saving new note:', data.error);
        }
    } catch (error) {
        console.error('Network error saving new note:', error);
        alert('An error occurred while saving the new note.');
    }
}

// Event listener for the "New Note" button
addNewNoteButton.addEventListener('click', () => {
    // For now, this button just shows an empty editor.
    // In a real app, this might trigger the audio transcription flow.
    currentNoteId = null; // Clear current note ID
    noteDetailTitle.innerHTML = 'New Note Title';
    noteDetailSummary.innerHTML = 'Start typing your summary here...';
    noteDetailTranscript.innerHTML = 'Transcript will appear here or can be typed.';
    noteDetailTimestamp.textContent = `Created: ${formatDate(new Date().toISOString())}`;
    noteDetailTags.innerHTML = 'No tags yet.';
    noteDetailTasks.innerHTML = 'No tasks yet.';
    noteDetailAudio.src = '';
    noteDetailAudio.style.display = 'none';

    introSection.style.display = 'none';
    noteDetailView.style.display = 'block';
    formattingToolbar.style.display = 'flex';
    setHasUnsavedChanges(true); // A new note is inherently "changed"

    // Set original content for new note as empty or default for comparison
    originalNoteContent = {
        title: noteDetailTitle.innerHTML,
        summary: noteDetailSummary.innerHTML,
        transcript: noteDetailTranscript.innerHTML,
        detected_tasks: []
    };

    // If this button is meant to trigger transcription, call that function here
    // e.g., show a modal for recording audio, then call saveNewTranscribedNote()
    alert("This 'New Note' button currently opens an empty editor. You'll need to manually add content or integrate it with your transcription flow (e.g., from 'Transcend' page).");
});


// --- Search Functionality ---
let searchTimeout;
searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    const query = searchInput.value.trim();
    if (query.length > 2) { // Only search if query is at least 3 characters
        searchLoading.style.display = 'block';
        searchResultsDiv.innerHTML = ''; // Clear previous results
        welcomeMessage.style.display = 'none'; // Hide welcome message during search
        categoryFilter.value = ""; // Reset category filter when typing in search
        searchTimeout = setTimeout(() => performSearch(query), 500); // Debounce
    } else if (query.length === 0) {
        searchResultsDiv.innerHTML = '';
        searchLoading.style.display = 'none';
        welcomeMessage.style.display = 'block'; // Show welcome message if search cleared
    }
});

sidebarSearchInput.addEventListener('input', () => {
    const query = sidebarSearchInput.value.toLowerCase();
    const notes = notesList.querySelectorAll('li a');
    notes.forEach(note => {
        const title = note.textContent.toLowerCase();
        if (title.includes(query)) {
            note.parentElement.style.display = 'block';
        } else {
            note.parentElement.style.display = 'none';
        }
    });
});

async function performSearch(query) {
    try {
        const response = await fetch(`/get_user_notes`); 
        const allNotes = await response.json();

        const filteredNotes = allNotes.filter(note => 
            (note.title && note.title.toLowerCase().includes(query.toLowerCase())) ||
            (note.summary && note.summary.toLowerCase().includes(query.toLowerCase())) ||
            (note.transcript && note.transcript.toLowerCase().includes(query.toLowerCase()))
        );


        searchLoading.style.display = 'none';
        searchResultsDiv.innerHTML = ''; 

        if (filteredNotes.length > 0) {
            filteredNotes.forEach(note => {
                const resultItem = document.createElement('div');
                resultItem.className = 'search-result-item';
                resultItem.innerHTML = `
                    <h4>${note.title || 'Untitled Note'}</h4>
                    <p>${note.summary || 'No summary available.'}</p>
                    <button class="view-button" data-note-id="${note._id}">View Note</button>
                `;
                resultItem.querySelector('.view-button').addEventListener('click', (e) => {
                    loadNoteDetails(e.target.dataset.noteId);
                    // Set active class in sidebar if note is there
                    document.querySelectorAll('#notesList a').forEach(a => {
                        a.classList.remove('active');
                        if (a.dataset.noteId === e.target.dataset.noteId) {
                            a.classList.add('active');
                        }
                    });
                });
                searchResultsDiv.appendChild(resultItem);
            });
        } else {
            searchResultsDiv.innerHTML = '<p style="text-align: center; color: var(--color-light-gray-text);">No notes found matching your search.</p>';
        }

    } catch (error) {
        console.error('Error performing search:', error);
        searchLoading.style.display = 'none';
        searchResultsDiv.innerHTML = '<p style="text-align: center; color: red;">Error performing search. Please try again.</p>';
    }
}


categoryFilter.addEventListener('change', () => {
    const selectedCategory = categoryFilter.value;
    searchInput.value = '';
    if (selectedCategory) {
        filterNotesByCategory(selectedCategory);
    } else {
        searchResultsDiv.innerHTML = '';
        welcomeMessage.style.display = 'block';
    }
});

async function filterNotesByCategory(category) {
    searchLoading.style.display = 'block';
    searchResultsDiv.innerHTML = '';
    welcomeMessage.style.display = 'none'; 

    try {
        const response = await fetch(`/get_notes_by_category?category=${encodeURIComponent(category)}`);
        const data = await response.json();

        searchLoading.style.display = 'none';

        if (response.ok && data.notes && data.notes.length > 0) {
            data.notes.forEach(note => {
                const resultItem = document.createElement('div');
                resultItem.className = 'search-result-item';
                resultItem.innerHTML = `
                    <h4>${note.title || 'Untitled Note'}</h4>
                    <p>${note.summary || 'No summary available.'}</p>
                    <button class="view-button" data-note-id="${note._id}">View Note</button>
                `;
                resultItem.querySelector('.view-button').addEventListener('click', (e) => {
                    loadNoteDetails(e.target.dataset.noteId);
                    document.querySelectorAll('#notesList a').forEach(a => {
                        a.classList.remove('active');
                        if (a.dataset.noteId === e.target.dataset.noteId) {
                            a.classList.add('active');
                        }
                    });
                });
                searchResultsDiv.appendChild(resultItem);
            });
        } else {
            searchResultsDiv.innerHTML = `<p style="text-align: center; color: var(--color-light-gray-text);">No notes found in '${category}' category.</p>`;
        }
    } catch (error) {
        console.error('Error filtering notes by category:', error);
        searchLoading.style.display = 'none';
        searchResultsDiv.innerHTML = '<p style="text-align: center; color: red;">Error filtering notes. Please try again.</p>';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    fetchNotesForSidebar();
    introSection.style.display = 'flex'; 
    noteDetailView.style.display = 'none';
    formattingToolbar.style.display = 'none'; 
    setHasUnsavedChanges(false); 
});