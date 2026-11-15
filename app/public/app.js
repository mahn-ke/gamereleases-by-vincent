// Reminder bells, auto-applied filters, date jump and copy buttons
document.addEventListener('click', async (event) => {
    const bell = event.target.closest('button.bell[data-game]');
    if (bell) {
        const enabled = !bell.classList.contains('on');
        bell.classList.add('busy');
        try {
            const response = await fetch(`/api/reminders/${bell.dataset.game}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled }),
            });
            if (response.status === 401) {
                location.href = `/login?return=${encodeURIComponent(location.pathname + location.search)}`;
                return;
            }
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const { reminded, count } = await response.json();
            // The same game can appear more than once on a page
            for (const other of document.querySelectorAll(`button.bell[data-game="${bell.dataset.game}"]`)) {
                other.classList.toggle('on', reminded);
                other.setAttribute('aria-pressed', String(reminded));
                other.querySelector('span').textContent = count;
            }
        } catch (error) {
            bell.animate([{ transform: 'translateX(-3px)' }, { transform: 'translateX(3px)' }, { transform: 'none' }], 200);
            console.error('Updating reminder failed', error);
        } finally {
            bell.classList.remove('busy');
        }
        return;
    }

    const copy = event.target.closest('[data-copy]');
    if (copy) {
        const input = document.getElementById(copy.dataset.copy);
        input.select();
        try {
            await navigator.clipboard.writeText(input.value);
            copy.textContent = 'Copied';
            setTimeout(() => { copy.textContent = 'Copy'; }, 1500);
        } catch {
            document.execCommand('copy');
        }
    }
});

document.addEventListener('change', (event) => {
    if (event.target.matches('.filter-form input[type=checkbox], .datepick input[type=date], .mail-form input[type=checkbox]')) {
        event.target.form.submit();
    }
});

// Opening the native date picker from the label works in browsers that support it
for (const input of document.querySelectorAll('.datepick input[type=date]')) {
    input.addEventListener('click', () => input.showPicker?.());
}

const popularity = document.querySelector('[data-popscore]');
if (popularity) {
    const state = popularity.querySelector('[data-popscore-state]');
    const progress = popularity.querySelector('progress');
    const start = popularity.querySelector('[data-popscore-start]');
    const cancel = popularity.querySelector('[data-popscore-cancel]');
    const error = popularity.querySelector('[data-popscore-error]');
    const phases = {
        fetching_list: 'Fetching list', fetching_metrics: 'Fetching popularity',
        saving_batch: 'Saving batch', completed: 'Completed', canceling: 'Canceling',
        canceled: 'Canceled', failed: 'Failed', interrupted: 'Interrupted',
    };
    let timer;
    let busy = false;
    let authorized = true;
    let disposed = false;
    let controller;

    function render(data) {
        const job = data.job;
        state.textContent = job ? `${phases[job.state] || job.state}: ${job.completed} of ${job.total} games refreshed` : 'No refresh run yet';
        progress.max = Math.max(1, job?.total || 0);
        progress.value = job?.completed || 0;
        popularity.querySelector('[data-popscore-busy]').hidden = !data.running;
        popularity.querySelector('[data-popscore-completed]').textContent = `Last completed: ${data.lastCompleted || 'Never'}`;
        popularity.querySelector('[data-popscore-next]').textContent = `Next refresh: ${data.nextRefresh}`;
        error.textContent = job?.error || (!data.configured ? 'IGDB is not configured.' : '');
        start.disabled = data.running || !data.configured;
        cancel.hidden = !data.running;
        cancel.disabled = job?.state === 'canceling';
    }

    async function update(action) {
        if (busy || !authorized || disposed) return;
        clearTimeout(timer);
        busy = true;
        start.disabled = cancel.disabled = true;
        controller = new AbortController();
        try {
            const response = await fetch(`/api/popscore${action ? `/${action}` : ''}`, {
                method: action ? 'POST' : 'GET', signal: controller.signal,
            });
            if ([401, 403].includes(response.status)) authorized = false;
            const data = await response.json();
            if (!response.ok && response.status !== 409) throw new Error(data.error || `HTTP ${response.status}`);
            render(data);
        } catch (failure) {
            if (!controller.signal.aborted) {
                error.textContent = `${failure.message}${authorized ? ' Retrying status shortly.' : ' Log in again to check your role.'}`;
                console.error('Popularity status failed', failure);
            }
        } finally {
            busy = false;
            if (!disposed && authorized && !document.hidden) timer = setTimeout(() => update(), 2000);
        }
    }

    start.addEventListener('click', () => update('start'));
    cancel.addEventListener('click', () => update('cancel'));
    document.addEventListener('visibilitychange', () => {
        clearTimeout(timer);
        if (!document.hidden) update();
    });
    window.addEventListener('pagehide', () => {
        disposed = true;
        clearTimeout(timer);
        controller?.abort();
    });
    window.addEventListener('pageshow', event => {
        if (event.persisted) { disposed = false; update(); }
    });
    if (!document.hidden) update();
}
