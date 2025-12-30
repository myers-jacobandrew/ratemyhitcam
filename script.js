// Supabase config
// 1) Create a Supabase project
// 2) Paste your Project URL and anon public key here
const SUPABASE_URL = 'https://xxfzetutgmxhmwtztjbd.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_i8YRYdwtqU-vo9E0SxuVNA_mpdG_dgU';

function getOrCreateRaterId() {
    const key = 'raterId';
    const existing = localStorage.getItem(key);
    if (existing) return existing;

    const raterId = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : String(Date.now()) + '-' + String(Math.random()).slice(2);
    localStorage.setItem(key, raterId);
    return raterId;
}

// Hit Rating System
class HitRatingSystem {
    constructor() {
        this.adminPasscode = 'hitcam';
        this.isAdmin = this.loadAdminState();
        this.editingHitId = null;
        this.hits = [];
        this.raterId = getOrCreateRaterId();
        this.supabase = this.createSupabaseClient();

        this.initializeEventListeners();
        this.updateAdminUI();
        this.init();
    }

    createSupabaseClient() {
        const hasConfig = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
        if (!hasConfig) return null;

        if (!window.supabase || !window.supabase.createClient) return null;
        return window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }

    async init() {
        await this.refreshHitsFromServer();
        this.renderHits();
        this.updateStats();
    }

    loadAdminState() {
        return localStorage.getItem('isAdmin') === 'true';
    }

    setAdminState(isAdmin) {
        this.isAdmin = isAdmin;
        localStorage.setItem('isAdmin', isAdmin ? 'true' : 'false');
        this.updateAdminUI();
        this.renderHits();
    }

    updateAdminUI() {
        const status = document.getElementById('adminStatus');
        if (status) status.textContent = this.isAdmin ? 'Admin' : 'Guest';

        const logoutBtn = document.getElementById('adminLogoutBtn');
        if (logoutBtn) logoutBtn.style.display = this.isAdmin ? 'inline-flex' : 'none';

        const loginBtn = document.getElementById('adminLoginBtn');
        if (loginBtn) loginBtn.style.display = this.isAdmin ? 'none' : 'inline-flex';
    }

    // Get default sample hits
    getDefaultHits() {
        return [
            {
                id: 1,
                reason: "Made a terrible dad joke about programming",
                type: "slap",
                description: "Nick said 'Why do programmers prefer dark mode? Because light attracts bugs!' Cam delivered a swift but fair slap.",
                timestamp: new Date(Date.now() - 86400000).toISOString(),
                ratings: [5, 4, 5, 3, 4],
                averageRating: 4.2
            },
            {
                id: 2,
                reason: "Left dirty dishes in the sink",
                type: "poke",
                description: "Classic offense. Cam responded with repeated annoying pokes until Nick cleaned up.",
                timestamp: new Date(Date.now() - 172800000).toISOString(),
                ratings: [4, 3, 4],
                averageRating: 3.7
            }
        ];
    }

    async refreshHitsFromServer() {
        if (!this.supabase) {
            this.hits = this.getDefaultHits();
            return;
        }

        const { data: hits, error: hitsError } = await this.supabase
            .from('hits')
            .select('id, reason, type, description, created_at')
            .order('created_at', { ascending: false })
            .limit(50);

        if (hitsError) {
            console.error('Supabase hits select error:', hitsError);
            this.showNotification(`Could not load hits from server. (${hitsError.message})`);
            this.hits = [];
            return;
        }

        const hitIds = (hits || []).map(h => h.id);
        let ratingsByHitId = {};
        if (hitIds.length > 0) {
            const { data: ratings, error: ratingsError } = await this.supabase
                .from('hit_ratings')
                .select('hit_id, rating')
                .in('hit_id', hitIds);

            if (ratingsError) {
                console.error('Supabase ratings select error:', ratingsError);
            }
            if (!ratingsError && ratings) {
                ratingsByHitId = ratings.reduce((acc, row) => {
                    const key = row.hit_id;
                    acc[key] = acc[key] || [];
                    acc[key].push(row.rating);
                    return acc;
                }, {});
            }
        }

        this.hits = (hits || []).map(h => {
            const ratings = ratingsByHitId[h.id] || [];
            const averageRating = ratings.length > 0
                ? ratings.reduce((a, b) => a + b, 0) / ratings.length
                : 0;

            return {
                id: h.id,
                reason: h.reason,
                type: h.type,
                description: h.description,
                timestamp: h.created_at,
                ratings,
                averageRating
            };
        });
    }

    // Initialize event listeners
    initializeEventListeners() {
        // Form submission
        document.getElementById('hitForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.submitHit();
        });

        const adminToggleBtn = document.getElementById('adminToggleBtn');
        if (adminToggleBtn) {
            adminToggleBtn.addEventListener('click', () => this.openAdminModal('login'));
        }

        const adminModalClose = document.getElementById('adminModalClose');
        if (adminModalClose) {
            adminModalClose.addEventListener('click', () => this.closeAdminModal());
        }

        const adminModal = document.getElementById('adminModal');
        if (adminModal) {
            adminModal.addEventListener('click', (e) => {
                if (e.target === adminModal) this.closeAdminModal();
            });
        }

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') this.closeAdminModal();
        });

        const adminLoginBtn = document.getElementById('adminLoginBtn');
        if (adminLoginBtn) {
            adminLoginBtn.addEventListener('click', () => this.handleAdminLogin());
        }

        const adminLogoutBtn = document.getElementById('adminLogoutBtn');
        if (adminLogoutBtn) {
            adminLogoutBtn.addEventListener('click', () => {
                this.setAdminState(false);
                this.closeAdminModal();
                this.showNotification('Logged out.');
            });
        }

        const editHitForm = document.getElementById('editHitForm');
        if (editHitForm) {
            editHitForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                await this.saveEditHit();
            });
        }

        const editCancelBtn = document.getElementById('editCancelBtn');
        if (editCancelBtn) {
            editCancelBtn.addEventListener('click', () => {
                this.editingHitId = null;
                this.openAdminModal('login');
            });
        }

        const hitsList = document.getElementById('hitsList');
        if (hitsList) {
            hitsList.addEventListener('click', async (e) => {
                const btn = e.target.closest('button');
                if (!btn) return;
                const action = btn.dataset.action;
                const hitId = btn.dataset.hitId ? parseInt(btn.dataset.hitId, 10) : null;
                if (!action || !hitId) return;

                if (action === 'edit' && this.isAdmin) {
                    this.startEditHit(hitId);
                }
                if (action === 'delete' && this.isAdmin) {
                    await this.deleteHit(hitId);
                }
            });
        }

        // no-op
    }

    openAdminModal(view) {
        const adminModal = document.getElementById('adminModal');
        const loginView = document.getElementById('adminLoginView');
        const editView = document.getElementById('adminEditView');
        if (!adminModal || !loginView || !editView) return;

        adminModal.classList.add('open');
        adminModal.setAttribute('aria-hidden', 'false');

        if (view === 'edit') {
            loginView.style.display = 'none';
            editView.style.display = 'block';
        } else {
            loginView.style.display = 'block';
            editView.style.display = 'none';
        }

        this.updateAdminUI();
    }

    closeAdminModal() {
        const adminModal = document.getElementById('adminModal');
        if (!adminModal) return;
        adminModal.classList.remove('open');
        adminModal.setAttribute('aria-hidden', 'true');
    }

    handleAdminLogin() {
        const passInput = document.getElementById('adminPasscode');
        const passcode = passInput ? passInput.value : '';
        if (passcode === this.adminPasscode) {
            this.setAdminState(true);
            if (passInput) passInput.value = '';
            this.closeAdminModal();
            this.showNotification('Admin enabled.');
            return;
        }
        this.showNotification('Wrong passcode.');
    }

    // Submit a new hit
    async submitHit() {
        const form = document.getElementById('hitForm');
        const reason = document.getElementById('hitReason').value;
        const type = document.getElementById('hitType').value;
        const description = document.getElementById('hitDescription').value;

        if (!this.supabase) {
            this.showNotification('Supabase is not configured yet.');
            return;
        }

        const { data, error } = await this.supabase
            .from('hits')
            .insert({ reason, type, description })
            .select('id, reason, type, description, created_at')
            .single();

        if (error || !data) {
            console.error('Supabase hits insert error:', error);
            this.showNotification(`Could not submit hit. (${error ? error.message : 'no data'})`);
            return;
        }

        const newHit = {
            id: data.id,
            reason: data.reason,
            type: data.type,
            description: data.description,
            timestamp: data.created_at,
            ratings: [],
            averageRating: 0
        };

        this.hits.unshift(newHit);
        this.renderHits();
        this.updateStats();
        
        // Reset form
        form.reset();
        // no-op
        
        // Show success message
        this.showNotification('Hit submitted successfully! Now get your friends to rate it! 🎯');
    }

    // Render all hits
    renderHits() {
        const hitsList = document.getElementById('hitsList');
        
        if (this.hits.length === 0) {
            hitsList.innerHTML = `
                <div class="empty-state">
                    <h4>No hits yet!</h4>
                    <p>Submit the first hit to get started.</p>
                </div>
            `;
            return;
        }

        hitsList.innerHTML = this.hits.map(hit => this.renderHitCard(hit)).join('');
        
        // Add rating event listeners
        this.hits.forEach(hit => {
            this.addRatingListeners(hit.id);
        });
    }

    // Render individual hit card
    renderHitCard(hit) {
        const typeEmoji = this.getTypeEmoji(hit.type);
        const timeAgo = this.getTimeAgo(hit.timestamp);
        const adminControls = this.isAdmin
            ? `
                <div class="admin-actions">
                    <button class="admin-action-btn" type="button" data-action="edit" data-hit-id="${hit.id}">Edit</button>
                    <button class="admin-action-btn danger" type="button" data-action="delete" data-hit-id="${hit.id}">Delete</button>
                </div>
            `
            : '';
        
        return `
            <div class="hit-card" data-hit-id="${hit.id}">
                <div class="hit-header">
                    <span class="hit-type">${typeEmoji} ${this.getTypeLabel(hit.type)}</span>
                </div>
                
                <div class="hit-reason">🎯 ${hit.reason}</div>
                
                ${hit.description ? `<div class="hit-description">${hit.description}</div>` : ''}
                
                <div class="hit-actions">
                    <div class="hit-rating">
                        <div class="rating-stars" data-hit-id="${hit.id}">
                            ${this.renderStars(hit.id, hit.averageRating)}
                        </div>
                        <span class="rating-count">
                            ${hit.ratings.length > 0 ? `${hit.ratings.length} ratings • ${hit.averageRating.toFixed(1)}` : 'No ratings yet'}
                        </span>
                    </div>
                    ${adminControls}
                </div>
                
                <div style="margin-top: 0.5rem; font-size: 0.8rem; color: rgba(229, 231, 235, 0.45);">
                    ${timeAgo}
                </div>
            </div>
        `;
    }

    startEditHit(hitId) {
        const hit = this.hits.find(h => h.id === hitId);
        if (!hit) return;

        this.editingHitId = hitId;

        const editId = document.getElementById('editHitId');
        const editReason = document.getElementById('editHitReason');
        const editType = document.getElementById('editHitType');
        const editDescription = document.getElementById('editHitDescription');

        if (editId) editId.value = String(hit.id);
        if (editReason) editReason.value = hit.reason || '';
        if (editType) editType.value = hit.type || 'other';
        if (editDescription) editDescription.value = hit.description || '';

        this.openAdminModal('edit');
    }

    async saveEditHit() {
        if (!this.isAdmin || !this.editingHitId) return;
        const hit = this.hits.find(h => h.id === this.editingHitId);
        if (!hit) return;

        if (!this.supabase) {
            this.showNotification('Supabase is not configured yet.');
            return;
        }

        const editReason = document.getElementById('editHitReason');
        const editType = document.getElementById('editHitType');
        const editDescription = document.getElementById('editHitDescription');

        const nextReason = editReason ? editReason.value : hit.reason;
        const nextType = editType ? editType.value : hit.type;
        const nextDescription = editDescription ? editDescription.value : hit.description;

        const { error } = await this.supabase
            .from('hits')
            .update({ reason: nextReason, type: nextType, description: nextDescription })
            .eq('id', hit.id);

        if (error) {
            console.error('Supabase hits update error:', error);
            this.showNotification(`Could not update hit. (${error.message})`);
            return;
        }

        hit.reason = nextReason;
        hit.type = nextType;
        hit.description = nextDescription;

        this.renderHits();
        this.updateStats();
        this.editingHitId = null;
        this.openAdminModal('login');
        this.showNotification('Hit updated.');
    }

    async deleteHit(hitId) {
        const hit = this.hits.find(h => h.id === hitId);
        if (!hit) return;
        const ok = window.confirm('Delete this hit?');
        if (!ok) return;

        if (!this.supabase) {
            this.showNotification('Supabase is not configured yet.');
            return;
        }

        const { error } = await this.supabase
            .from('hits')
            .delete()
            .eq('id', hit.id);

        if (error) {
            console.error('Supabase hits delete error:', error);
            this.showNotification(`Could not delete hit. (${error.message})`);
            return;
        }

        this.hits = this.hits.filter(h => h.id !== hitId);
        this.renderHits();
        this.updateStats();
        this.showNotification('Hit deleted.');
    }

    // Render star rating
    renderStars(hitId, averageRating) {
        let stars = '';
        for (let i = 1; i <= 5; i++) {
            const filled = i <= Math.round(averageRating);
            stars += `<span class="star ${filled ? 'filled' : ''}" data-rating="${i}" data-hit-id="${hitId}">⭐</span>`;
        }
        return stars;
    }

    // Add rating listeners to stars
    addRatingListeners(hitId) {
        const stars = document.querySelectorAll(`.star[data-hit-id="${hitId}"]`);
        stars.forEach(star => {
            star.addEventListener('click', () => {
                const rating = parseInt(star.dataset.rating);
                this.rateHit(hitId, rating);
            });
        });
    }

    // Rate a hit
    async rateHit(hitId, rating) {
        const hit = this.hits.find(h => h.id === hitId);
        if (!hit) return;

        if (!this.supabase) {
            this.showNotification('Supabase is not configured yet.');
            return;
        }

        const { error } = await this.supabase
            .from('hit_ratings')
            .insert({ hit_id: hit.id, rater_id: this.raterId, rating });

        if (error) {
            console.error('Supabase hit_ratings insert error:', error);
            if (error.code === '23505') {
                this.showNotification('You\'ve already rated this hit! 🌟');
                return;
            }
            this.showNotification(`Could not submit rating. (${error.message})`);
            return;
        }

        hit.ratings.push(rating);
        hit.averageRating = hit.ratings.reduce((a, b) => a + b, 0) / hit.ratings.length;
        this.renderHits();
        this.updateStats();
        this.showNotification(`Hit rated ${rating} stars! ⭐`);
    }

    // Update statistics
    updateStats() {
        const totalHits = this.hits.length;
        const ratedHits = this.hits.filter(h => h.ratings.length > 0);
        const avgRating = ratedHits.length > 0
            ? ratedHits.reduce((sum, h) => sum + h.averageRating, 0) / ratedHits.length
            : 0;
        
        const typeCounts = {};
        this.hits.forEach(hit => {
            typeCounts[hit.type] = (typeCounts[hit.type] || 0) + 1;
        });
        
        const mostCommonType = Object.keys(typeCounts).length > 0
            ? Object.keys(typeCounts).reduce((a, b) => typeCounts[a] > typeCounts[b] ? a : b)
            : 'None';

        document.getElementById('totalHits').textContent = totalHits;
        document.getElementById('avgRating').textContent = avgRating > 0 ? avgRating.toFixed(1) : '0.0';
        document.getElementById('commonType').textContent = mostCommonType !== 'None' ? this.getTypeLabel(mostCommonType) : 'None';
    }

    // Helper functions
    getTypeEmoji(type) {
        const emojis = {
            slap: '🖐️',
            poke: '👉',
            nerf_gun: '�',
            throwing_misc: '🦝',
            pillow: '🛏️',
            other: '❓'
        };
        return emojis[type] || '❓';
    }

    getTypeLabel(type) {
        const labels = {
            slap: 'Classic Slap',
            poke: 'Annoying Poke',
            nerf_gun: 'Nerf Gun',
            throwing_misc: 'Throwing Misc Things (Raccoon)',
            pillow: 'Pillow Attack',
            other: 'Other'
        };
        return labels[type] || 'Other';
    }

    getTimeAgo(timestamp) {
        const now = new Date();
        const hitTime = new Date(timestamp);
        const diffMs = now - hitTime;
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffHours / 24);

        if (diffDays > 0) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
        if (diffHours > 0) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
        return 'Just now';
    }

    // Show notification
    showNotification(message) {
        // Create notification element
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: rgba(15, 20, 32, 0.92);
            color: rgba(229, 231, 235, 0.95);
            padding: 1rem 1.5rem;
            border-radius: 8px;
            border: 1px solid rgba(255, 255, 255, 0.12);
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.55);
            z-index: 1000;
            animation: slideIn 0.3s ease;
            font-weight: 600;
            backdrop-filter: blur(14px);
        `;
        notification.textContent = message;
        
        document.body.appendChild(notification);
        
        // Remove after 3 seconds
        setTimeout(() => {
            notification.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => {
                document.body.removeChild(notification);
            }, 300);
        }, 3000);
    }
}

// Add slideOut animation
const style = document.createElement('style');
style.textContent = `
    @keyframes slideOut {
        to {
            opacity: 0;
            transform: translateX(100px);
        }
    }
`;
document.head.appendChild(style);

// Initialize the system when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new HitRatingSystem();
});

// Add some fun easter eggs
document.addEventListener('DOMContentLoaded', () => {
    // Konami code for fun
    let konamiCode = [];
    const secretCode = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
    
    document.addEventListener('keydown', (e) => {
        konamiCode.push(e.key);
        konamiCode = konamiCode.slice(-10);
        
        if (konamiCode.join(',') === secretCode.join(',')) {
            document.body.style.animation = 'rainbow 2s linear infinite';
            setTimeout(() => {
                document.body.style.animation = '';
            }, 5000);
        }
    });
    
    // Add rainbow animation
    const rainbowStyle = document.createElement('style');
    rainbowStyle.textContent = `
        @keyframes rainbow {
            0% { filter: hue-rotate(0deg); }
            100% { filter: hue-rotate(360deg); }
        }
    `;
    document.head.appendChild(rainbowStyle);
});
