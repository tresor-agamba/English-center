(() => {
  const message = document.querySelector('#recorder-message');
  if (!message) return;
  const supportedTypes = [
    'audio/webm;codecs=opus',
    'audio/ogg;codecs=opus',
    'audio/mp4',
    'audio/webm',
  ];
  const mimeType = window.MediaRecorder
    ? supportedTypes.find(type => MediaRecorder.isTypeSupported(type))
    : null;
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder || !mimeType) {
    message.textContent = 'Ce navigateur ne permet pas l’enregistrement direct. Utilisez l’import de fichier audio.';
    document.querySelectorAll('.prepare-record').forEach(button => { button.disabled = true; });
    return;
  }
  let active = null;
  const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  function setMessage(value, error = false) {
    message.textContent = value;
    message.classList.toggle('error-message', error);
  }
  async function prepare(card) {
    if (active) return setMessage('Un enregistrement est déjà en cours.', true);
    const seconds = Number(card.dataset.preparation);
    const timer = card.querySelector('.record-timer');
    for (let remaining = seconds; remaining > 0; remaining -= 1) {
      timer.textContent = `Préparation : ${remaining} s`;
      await wait(1000);
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch {
      return setMessage('Accès au microphone refusé. Autorisez-le ou importez un fichier audio.', true);
    }
    const chunks = [];
    const recorder = new MediaRecorder(stream, { mimeType });
    const maximum = Number(card.dataset.duration);
    const startedAt = Date.now();
    const interval = setInterval(() => {
      const elapsed = Math.ceil((Date.now() - startedAt) / 1000);
      timer.textContent = `Enregistrement : ${elapsed}/${maximum} s`;
      if (elapsed >= maximum && recorder.state === 'recording') recorder.stop();
    }, 250);
    recorder.addEventListener('dataavailable', event => { if (event.data.size) chunks.push(event.data); });
    recorder.addEventListener('stop', () => {
      clearInterval(interval);
      stream.getTracks().forEach(track => track.stop());
      const blob = new Blob(chunks, { type: mimeType });
      const preview = card.querySelector('.record-preview');
      if (preview.dataset.url) URL.revokeObjectURL(preview.dataset.url);
      preview.dataset.url = URL.createObjectURL(blob);
      preview.src = preview.dataset.url;
      preview.hidden = false;
      card._recordedBlob = blob;
      card.querySelector('.upload-record').disabled = false;
      card.querySelector('.stop-record').disabled = true;
      card.querySelector('.prepare-record').disabled = false;
      timer.textContent = 'Enregistrement prêt à être envoyé.';
      active = null;
    });
    recorder.start(250);
    active = { recorder, card };
    card.querySelector('.prepare-record').disabled = true;
    card.querySelector('.stop-record').disabled = false;
    setMessage('Enregistrement en cours. La durée sera revérifiée par le serveur.');
  }
  async function upload(card) {
    if (!card._recordedBlob) return;
    const button = card.querySelector('.upload-record');
    button.disabled = true;
    const form = new FormData();
    const extension = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'm4a' : 'webm';
    form.append('audio', card._recordedBlob, `recording.${extension}`);
    try {
      const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || '';
      const response = await fetch(card.dataset.upload, { method: 'POST', body: form, credentials: 'same-origin', headers: { 'X-CSRF-Token': csrfToken } });
      if (!response.ok) throw new Error();
      window.location.reload();
    } catch {
      button.disabled = false;
      setMessage('L’envoi a échoué. Vérifiez votre réseau puis réessayez.', true);
    }
  }
  document.addEventListener('click', event => {
    const card = event.target.closest('.oral-question');
    if (!card) return;
    if (event.target.matches('.prepare-record')) prepare(card);
    if (event.target.matches('.stop-record') && active?.card === card && active.recorder.state === 'recording') active.recorder.stop();
    if (event.target.matches('.upload-record')) upload(card);
  });
})();
