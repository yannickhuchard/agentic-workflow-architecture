document.addEventListener('DOMContentLoaded', () => {
    // 1. Theme Management
    const themeToggle = document.querySelector('.theme-toggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
            const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', newTheme);
            localStorage.setItem('awa-theme', newTheme);
            themeToggle.innerHTML = newTheme === 'dark' ? '☀️' : '🌙';
        });

        // Initialize theme
        const savedTheme = localStorage.getItem('awa-theme') || 'dark';
        document.documentElement.setAttribute('data-theme', savedTheme);
        themeToggle.innerHTML = savedTheme === 'dark' ? '☀️' : '🌙';
    }

    // 2. Code Tabs Management
    const initCodeTabs = () => {
        const tabGroups = document.querySelectorAll('.code-tabs');
        tabGroups.forEach(group => {
            const buttons = group.querySelectorAll('.tab-btn');
            const contents = group.querySelectorAll('.tab-content');

            buttons.forEach(btn => {
                btn.addEventListener('click', () => {
                    const lang = btn.getAttribute('data-lang');

                    // Update all buttons in this group
                    buttons.forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');

                    // Update contents
                    contents.forEach(content => {
                        content.classList.toggle('active', content.getAttribute('data-lang') === lang);
                    });

                    // Persist preference across groups? 
                    // Let's make it smarter: change all tabs on the page to the same lang
                    document.querySelectorAll(`.tab-btn[data-lang="${lang}"]`).forEach(b => {
                        const parent = b.closest('.code-tabs');
                        if (parent) {
                            parent.querySelectorAll('.tab-btn').forEach(btn_other => btn_other.classList.remove('active'));
                            b.classList.add('active');
                            parent.querySelectorAll('.tab-content').forEach(c => {
                                c.classList.toggle('active', c.getAttribute('data-lang') === lang);
                            });
                        }
                    });
                });
            });
        });
    };
    initCodeTabs();

    // 3. Search Logic (Simple DOM Filter)
    const searchInput = document.querySelector('.search-input');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const term = e.target.value.toLowerCase();
            const sections = document.querySelectorAll('section');

            sections.forEach(section => {
                const text = section.innerText.toLowerCase();
                const isMatch = text.includes(term);
                section.style.display = isMatch ? 'block' : 'none';
            });
        });
    }

    // 4. Sidebar Active State
    const currentPath = window.location.pathname;
    const navLinks = document.querySelectorAll('.nav-link');
    navLinks.forEach(link => {
        const href = link.getAttribute('href');
        if (currentPath.endsWith(href)) {
            link.classList.add('active');
        } else {
            link.classList.remove('active');
        }
    });
});
