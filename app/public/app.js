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
