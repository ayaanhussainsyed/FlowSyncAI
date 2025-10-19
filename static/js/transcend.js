const micButton = document.getElementById('micButton');
const transcriptArea = document.getElementById('transcript-area');
const transcriptContent = document.getElementById('transcript-content');
const generateSummaryButton = document.getElementById('generateSummaryButton');
const summaryArea = document.getElementById('summary-area');
const noteTitleElement = document.getElementById('note-title'); // New: Get title element
const summaryContent = document.getElementById('summary-content');
const tasksContent = document.getElementById('tasks-content');
const tagsContent = document.getElementById('tags-content');
const uploadTasksButton = document.getElementById('uploadTasksButton');
const saveNoteButton = document.getElementById('saveNoteButton');
const loadingIndicator = document.getElementById('loading-indicator');

let mediaRecorder;
let audioChunks = [];
let isRecording = false;
let fullTranscriptText = '';
let currentSummaryData = null; // Store the last generated summary data (includes title, tasks, and tags)
let recordedAudioBlob = null;

const TRANSCRIPT_TRUNCATE_LIMIT = 500;

micButton.addEventListener('click', async () => {
    if (!isRecording) {
        // Reset all display elements
        transcriptArea.style.display = 'none';
        transcriptArea.style.opacity = 0;
        summaryArea.style.display = 'none';
        summaryArea.style.opacity = 0;
        generateSummaryButton.style.display = 'none';
        uploadTasksButton.style.display = 'none';
        saveNoteButton.style.display = 'none';
        loadingIndicator.style.display = 'none';

        transcriptContent.textContent = '';
        noteTitleElement.textContent = ''; // Clear title
        summaryContent.textContent = '';
        tasksContent.innerHTML = '';
        tagsContent.innerHTML = '';
        fullTranscriptText = '';
        currentSummaryData = null;
        recordedAudioBlob = null;


        // Start recording
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream);
            audioChunks = [];

            mediaRecorder.ondataavailable = event => {
                audioChunks.push(event.data);
            };

            mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                recordedAudioBlob = audioBlob;
                sendAudioForTranscription(audioBlob);
            };

            mediaRecorder.start();
            micButton.classList.add('recording');
            isRecording = true;
            console.log('Recording started');

        } catch (error) {
            console.error('Error accessing microphone:', error);
            alert('Could not access microphone. Please ensure it is connected and permissions are granted.');
        }
    } else {
        // Stop recording
        mediaRecorder.stop();
        mediaRecorder.stream.getTracks().forEach(track => track.stop());
        micButton.classList.remove('recording');
        isRecording = false;
        console.log('Recording stopped');
        loadingIndicator.style.display = 'block';
    }
});

async function sendAudioForTranscription(audioBlob) {
    const formData = new FormData();
    formData.append('audio_file', audioBlob, 'recording.webm');

    try {
        const response = await fetch('/transcribe_audio', {
            method: 'POST',
            body: formData,
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        console.log('Transcription response:', data);

        loadingIndicator.style.display = 'none';

        if (data.transcript) {
            fullTranscriptText = data.transcript;

            if (fullTranscriptText.length > TRANSCRIPT_TRUNCATE_LIMIT) {
                const truncatedText = fullTranscriptText.substring(0, TRANSCRIPT_TRUNCATE_LIMIT) + '...';
                transcriptContent.textContent = truncatedText;
                const readMoreButton = document.createElement('button');
                readMoreButton.className = 'read-more-button';
                readMoreButton.textContent = 'Read More';
                readMoreButton.onclick = () => {
                    transcriptContent.textContent = fullTranscriptText;
                    readMoreButton.remove();
                };
                transcriptContent.appendChild(readMoreButton);
            } else {
                transcriptContent.textContent = fullTranscriptText;
            }
            
            transcriptArea.style.display = 'block';
            setTimeout(() => {
                transcriptArea.style.opacity = 1;
            }, 10);

            setTimeout(() => {
                generateSummaryButton.style.display = 'block';
            }, 500);

        } else if (data.error) {
            transcriptArea.style.display = 'block';
            transcriptContent.textContent = `Error: ${data.error}`;
            setTimeout(() => {
                transcriptArea.style.opacity = 1;
            }, 10);
        } else {
            transcriptArea.style.display = 'block';
            transcriptContent.textContent = 'No transcript received.';
            setTimeout(() => {
                transcriptArea.style.opacity = 1;
            }, 10);
        }

    } catch (error) {
        console.error('Error sending audio for transcription:', error);
        loadingIndicator.style.display = 'none';
        transcriptArea.style.display = 'block';
        transcriptContent.textContent = `Failed to get transcription: ${error.message}. Please try again.`;
        generateSummaryButton.style.display = 'none';
        setTimeout(() => {
            transcriptArea.style.opacity = 1;
        }, 10);
    }
}

generateSummaryButton.addEventListener('click', async () => {
    if (!fullTranscriptText) { 
        alert("No transcript available to summarize.");
        return;
    }

    // Hide previous summary/tasks/tags and show loading
    summaryArea.style.display = 'none';
    summaryArea.style.opacity = 0;
    uploadTasksButton.style.display = 'none';
    saveNoteButton.style.display = 'none';
    loadingIndicator.textContent = "Generating title, summary, tasks, and tags...";
    loadingIndicator.style.display = 'block';

    try {
        const response = await fetch('/generate_summary', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ transcript: fullTranscriptText }), 
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        console.log('Summary response:', data);

        currentSummaryData = data; // Store the entire response data

        loadingIndicator.style.display = 'none';
        summaryArea.style.display = 'block';

        // Display Title
        if (data.title) {
            noteTitleElement.textContent = data.title;
        } else {
            noteTitleElement.textContent = 'Untitled Note';
        }

        if (data.summary) {
            summaryContent.textContent = data.summary;
        } else {
            summaryContent.textContent = 'No summary generated.';
        }

        tagsContent.innerHTML = '';
        if (data.tags && data.tags.length > 0) {
            const tagHtml = data.tags.map(tag => `<span class="tag-item">#${tag.replace(/\s/g, '')}</span>`).join('');
            tagsContent.innerHTML = tagHtml;
        }

        tasksContent.innerHTML = '';
        if (data.detected_tasks && data.detected_tasks.length > 0) {
            tasksContent.innerHTML = '<h4>Tasks Detected:</h4><ul>' + 
                                       data.detected_tasks.map(task => `<li>${task}</li>`).join('') + 
                                       '</ul>';
            setTimeout(() => {
                uploadTasksButton.style.display = 'block';
            }, 500);
        } else {
            uploadTasksButton.style.display = 'none';
        }

        if (data.error) {
            noteTitleElement.textContent = 'Error'; // Clear title on error
            summaryContent.textContent = `Error: ${data.error}`;
            tagsContent.innerHTML = '';
            tasksContent.innerHTML = '';
            uploadTasksButton.style.display = 'none';
            saveNoteButton.style.display = 'none';
        } else {
            setTimeout(() => {
                saveNoteButton.style.display = 'block'; 
            }, 500);
        }

        setTimeout(() => {
            summaryArea.style.opacity = 1;
        }, 10);

    } catch (error) {
        console.error('Error generating summary:', error);
        loadingIndicator.style.display = 'none';
        summaryArea.style.display = 'block';
        noteTitleElement.textContent = 'Error'; // Clear title on error
        summaryContent.textContent = `Failed to generate summary: ${error.message}. Please try again.`;
        tagsContent.innerHTML = '';
        tasksContent.innerHTML = '';
        uploadTasksButton.style.display = 'none';
        saveNoteButton.style.display = 'none';
        setTimeout(() => {
            summaryArea.style.opacity = 1;
        }, 10);
    }
});

uploadTasksButton.addEventListener('click', () => {
    alert("Upload tasks to timeline functionality to be implemented!");
    console.log("Tasks to upload:", currentSummaryData.detected_tasks);
});

saveNoteButton.addEventListener('click', async () => {
    if (!fullTranscriptText || !currentSummaryData || !recordedAudioBlob || !currentSummaryData.title) {
        alert("Cannot save note. Missing title, transcript, summary data, or audio.");
        return;
    }

    loadingIndicator.textContent = "Saving your note...";
    loadingIndicator.style.display = 'block';
    saveNoteButton.style.display = 'none';

    const reader = new FileReader();
    reader.readAsDataURL(recordedAudioBlob);
    reader.onloadend = async function() {
        const base64Audio = reader.result.split(',')[1];

        const noteToSave = {
            title: currentSummaryData.title, // Include the title
            transcript: fullTranscriptText,
            summary: currentSummaryData.summary,
            tags: currentSummaryData.tags,
            detected_tasks: currentSummaryData.detected_tasks,
            audio_base64: base64Audio
        };

        try {
            const response = await fetch('/save_note', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(noteToSave),
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const result = await response.json();
            console.log('Save note response:', result);
            alert(result.message);
            loadingIndicator.style.display = 'none';

        } catch (error) {
            console.error('Error saving note:', error);
            alert(`Failed to save note: ${error.message}`);
            loadingIndicator.style.display = 'none';
            saveNoteButton.style.display = 'block';
        }
    };
    reader.onerror = function(error) {
        console.error('Error reading audio blob:', error);
        alert('Failed to read audio file for saving.');
        loadingIndicator.style.display = 'none';
        saveNoteButton.style.display = 'block';
    };
});
