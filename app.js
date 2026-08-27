import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc, deleteDoc, enableIndexedDbPersistence } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// Firebase Configuration
const firebaseConfig = {
  apiKey: "AIzaSyDx2ThlvOBz9h_kRcZbjZbo3G2kKizMI64",
  authDomain: "wisdom-media-valanchery.firebaseapp.com",
  projectId: "wisdom-media-valanchery",
  storageBucket: "wisdom-media-valanchery.firebasestorage.app",
  messagingSenderId: "1007163293908",
  appId: "1:1007163293908:web:81d32bfb8b27726d187b41"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Enable offline caching for instant loads
enableIndexedDbPersistence(db).catch((err) => {
    console.log("Persistence error:", err);
});

let equipment = [];
let programs = [];
let checkouts = [];
let fundAdditions = [];
let fundExpenses = [];
let currentUserRole = sessionStorage.getItem('mediaWingRole') || null;

function checkAuth() {
    if (currentUserRole) {
        document.getElementById('login-screen').classList.add('hidden');
        document.getElementById('app-dashboard').classList.remove('hidden');
        document.getElementById('current-role-display').textContent = currentUserRole.toUpperCase();
        
        // Hide admin-only elements if user is staff
        const adminElements = document.querySelectorAll('.admin-only');
        if (currentUserRole === 'staff') {
            adminElements.forEach(el => el.classList.add('hidden'));
        } else {
            adminElements.forEach(el => el.classList.remove('hidden'));
        }
        
        initData(); // Fetch data and render
    } else {
        document.getElementById('login-screen').classList.remove('hidden');
        document.getElementById('app-dashboard').classList.add('hidden');
    }
}

document.getElementById('login-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const u = document.getElementById('username').value.trim();
    const p = document.getElementById('password').value.trim();
    const err = document.getElementById('login-error');
    
    // Simple hardcoded auth (can be expanded to Firestore later)
    if (u === 'admin' && p === 'admin123') {
        currentUserRole = 'admin';
        sessionStorage.setItem('mediaWingRole', 'admin');
        err.classList.add('hidden');
        checkAuth();
    } else if (u === 'staff' && p === 'staff123') {
        currentUserRole = 'staff';
        sessionStorage.setItem('mediaWingRole', 'staff');
        err.classList.add('hidden');
        checkAuth();
    } else {
        err.classList.remove('hidden');
    }
});

document.getElementById('logout-btn').addEventListener('click', () => {
    currentUserRole = null;
    sessionStorage.removeItem('mediaWingRole');
    document.getElementById('login-form').reset();
    checkAuth();
});

async function initData() {
    try {
        const docRef = doc(db, "mediaWing", "mainData");
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
            const data = docSnap.data();
            equipment = data.equipment || [];
            programs = data.programs || [];
            checkouts = data.checkouts || [];
            fundAdditions = data.fundAdditions || [];
            fundExpenses = data.fundExpenses || [];
            
            // Auto-migrate old public equipment to fundExpenses if they aren't there
            let migrated = false;
            equipment.filter(e => e.ownership === 'Public').forEach(eq => {
                if (!fundExpenses.find(fe => fe.linkedEqId === eq.id)) {
                    fundExpenses.push({
                        id: 'exp_' + eq.id,
                        amount: parseFloat(eq.price || 0),
                        description: `Equipment: ${eq.name} (${eq.customId})`,
                        date: eq.addedOn || new Date().toISOString(),
                        linkedEqId: eq.id
                    });
                    migrated = true;
                }
            });
            
            // Self-healing: Recalculate availableQty to fix any lost items
            equipment.forEach(eq => {
                let currentlyOut = 0;
                checkouts.forEach(c => {
                    const prog = programs.find(p => p.id === c.programId);
                    if (prog) {
                        const itemInProg = c.items.find(i => i.equipmentId === eq.id);
                        if (itemInProg) {
                            currentlyOut += (itemInProg.qtyTaken - itemInProg.qtyReturned);
                        }
                    }
                });
                eq.availableQty = eq.totalQty - currentlyOut;
            });
            
            updateDashboard();
            renderInventory();
            renderHistoryTable();
            renderFundsTab(); // Initial render for funds
            
            if (migrated) saveData().catch(console.error); // Save migration silently
        } else {
            setDoc(docRef, { equipment: [], programs: [], checkouts: [], fundAdditions: [], fundExpenses: [] });
        }
    } catch (err) {
        console.error("Error loading data from Firebase", err);
        showToast('Error loading data. Check console.', 'error');
    }
}

async function saveData() {
    try {
        const docRef = doc(db, "mediaWing", "mainData");
        await setDoc(docRef, {
            equipment,
            programs,
            checkouts,
            fundAdditions,
            fundExpenses
        });
        
        // Sync to Google Sheets in the background (fire and forget)
        syncToGoogleSheets().catch(console.error);
        
        // We do NOT call updateDashboard here anymore, 
        // we call it instantly before saveData.
    } catch (err) {
        console.error("Error saving data to Firebase", err);
        showToast('Error syncing with server.', 'error');
        throw err;
    }
}

const GOOGLE_SHEETS_WEBHOOK = "https://script.google.com/macros/s/AKfycbyswVeTcH_xhpp2VeysjA7eltKmNaqZAlyBjMUg8mVr7krE91mKIlHShgjah0qzWB8B/exec";

async function syncToGoogleSheets() {
    try {
        const payload = {
            equipment,
            fundAdditions,
            fundExpenses
        };
        fetch(GOOGLE_SHEETS_WEBHOOK, {
            method: 'POST',
            mode: 'no-cors', // Bypasses strict CORS restrictions for GAS
            headers: {
                'Content-Type': 'text/plain;charset=utf-8' // Prevents preflight OPTIONS request
            },
            body: JSON.stringify(payload)
        }).catch(err => console.error('Error syncing to Google Sheets:', err));
    } catch (err) {
        console.error("Failed to prepare sync payload", err);
    }
}

function generateId() {
    return Math.random().toString(36).substr(2, 9);
}

// Compress Image to avoid Firestore 1MB limits
function compressImage(file, maxWidth = 800) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                if (width > maxWidth) {
                    height = Math.round((height * maxWidth) / width);
                    width = maxWidth;
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', 0.7));
            };
        };
    });
}

// --- Navigation Logic ---
const navLinks = document.querySelectorAll('.nav-link');
const sections = document.querySelectorAll('.content-section');

navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        const targetId = link.getAttribute('data-target');
        
        navLinks.forEach(n => n.classList.remove('active', 'border-l-4', 'border-blue-500'));
        link.classList.add('active');

        sections.forEach(s => s.classList.add('hidden'));
        document.getElementById(targetId).classList.remove('hidden');

        if (window.innerWidth < 768) {
            const sidebar = document.querySelector('aside');
            if (!sidebar.classList.contains('hidden')) {
                sidebar.classList.add('hidden');
                sidebar.classList.remove('absolute', 'z-40', 'h-full', 'w-64');
            }
        }

        if(targetId === 'inventory') renderInventory();
        if(targetId === 'checkout') {
            selectedCheckoutProgramId = null;
            currentCheckoutCart = [];
            document.getElementById('checkout-items-section')?.classList.add('hidden');
            renderCheckoutOptions();
        }
        if(targetId === 'checkin') {
            selectedCheckinProgramId = null;
            document.getElementById('checkin-items-section')?.classList.add('hidden');
            renderCheckinOptions();
        }
        if(targetId === 'history') renderHistoryTable();
    });
});

document.getElementById('mobile-menu-btn').addEventListener('click', () => {
    const sidebar = document.querySelector('aside');
    sidebar.classList.toggle('hidden');
    sidebar.classList.toggle('absolute');
    sidebar.classList.toggle('z-40');
    sidebar.classList.toggle('h-full');
});

window.toggleModal = function(modalId) {
    const modal = document.getElementById(modalId);
    modal.classList.toggle('hidden');
}

window.toggleOwnershipFields = function() {
    const ownership = document.querySelector('input[name="ownership"]:checked').value;
    if (ownership === 'Personal') {
        document.getElementById('personal-fields').classList.remove('hidden');
        document.getElementById('public-fields').classList.add('hidden');
    } else {
        document.getElementById('personal-fields').classList.add('hidden');
        document.getElementById('public-fields').classList.remove('hidden');
    }
}

function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast ${type} show`;
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function updateDashboard() {
    const totalItems = equipment.reduce((sum, item) => sum + parseInt(item.totalQty), 0);
    const availableItems = equipment.reduce((sum, item) => sum + parseInt(item.availableQty), 0);
    const activeProgs = programs.filter(p => p.status === 'Active').length;
    
    let itemsOut = 0;
    checkouts.forEach(c => {
        const prog = programs.find(p => p.id === c.programId);
        if (prog && prog.status === 'Active') {
            c.items.forEach(i => {
                itemsOut += (parseInt(i.qtyTaken) - parseInt(i.qtyReturned));
            });
        }
    });

    document.getElementById('stat-total-items').textContent = totalItems;
    document.getElementById('stat-available-items').textContent = availableItems;
    document.getElementById('stat-active-programs').textContent = activeProgs;
    document.getElementById('stat-items-out').textContent = itemsOut;
    
    // Also sync the Funds tab in case prices or public items changed
    if (typeof renderFundsTab === 'function') renderFundsTab();
}

// --- Inventory Logic ---
document.getElementById('add-equipment-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Processing...';

    const eqId = generateId();
    const customId = document.getElementById('eq-custom-id').value;
    const name = document.getElementById('eq-name').value;
    const addedDateStr = document.getElementById('eq-date').value;
    const addedOn = addedDateStr ? new Date(addedDateStr).toISOString() : new Date().toISOString();
    const category = document.getElementById('eq-category').value;
    const qty = parseInt(document.getElementById('eq-qty').value);
    const ownership = document.querySelector('input[name="ownership"]:checked').value;
    
    let photoCount = 0;
    let hasBill = false;

    // We still await image compression because we need it for the document,
    // but canvas compression is very fast.
    try {
        const photoFiles = document.getElementById('eq-photo').files;
        if (photoFiles.length > 0) {
            const maxPhotos = Math.min(photoFiles.length, 4);
            for (let i = 0; i < maxPhotos; i++) {
                submitBtn.textContent = `Compressing Photo ${i+1}...`;
                const compressedPhoto = await compressImage(photoFiles[i]);
                setDoc(doc(db, "mediaWingImages", `${eqId}_photo_${i}`), { data: compressedPhoto }).catch(console.error);
            }
            photoCount = maxPhotos;
        }

        let price = '';
        let ownerName = '';

        if (ownership === 'Public') {
            price = document.getElementById('eq-price').value;
            const billFile = document.getElementById('eq-bill').files[0];
            if (billFile) {
                submitBtn.textContent = 'Compressing Bill...';
                const compressedBill = await compressImage(billFile);
                setDoc(doc(db, "mediaWingImages", eqId + "_bill"), { data: compressedBill }).catch(console.error);
                hasBill = true;
            }
        } else {
            ownerName = document.getElementById('eq-owner').value;
        }

        const newItem = {
            id: eqId,
            customId: customId,
            name,
            category,
            totalQty: qty,
            availableQty: qty,
            ownership,
            ownerName,
            price,
            photoCount,
            addedOn: addedOn,
            hasBill
        };

        equipment.push(newItem);
        if (ownership === 'Public') {
            fundExpenses.push({
                id: 'exp_' + eqId,
                amount: parseFloat(price || 0),
                description: `Equipment: ${name} (${customId})`,
                date: newItem.addedOn,
                linkedEqId: eqId
            });
        }
        
        // Optimistic UI Update (Instant!)
        updateDashboard();
        renderInventory();
        toggleModal('add-item-modal');
        e.target.reset();
        toggleOwnershipFields();
        showToast('Equipment added instantly!');

        // Save in background
        saveData().catch(console.error);

    } catch (error) {
        console.error("Error uploading", error);
        alert("Failed to save: " + error.message);
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Save Item';
    }
});

document.getElementById('search-inventory').addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase().trim();
    if (!term) {
        renderInventory(equipment);
        return;
    }

    let filtered = equipment.filter(item => {
        const idMatch = item.customId && item.customId.toLowerCase().startsWith(term);
        const nameMatch = item.name && item.name.toLowerCase().split(' ').some(word => word.startsWith(term));
        return idMatch || nameMatch;
    });

    filtered.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    renderInventory(filtered);
});

function renderInventory(listToRender = equipment) {
    const tbody = document.getElementById('inventory-table-body');
    tbody.innerHTML = '';

    if (listToRender.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="px-6 py-4 text-center text-gray-500">No equipment found.</td></tr>';
        return;
    }

    listToRender.forEach(item => {
        let ownershipBadge = item.ownership === 'Personal' 
            ? `<span class="px-2 py-1 text-xs font-semibold rounded bg-yellow-100 text-yellow-800"><i class="fas fa-user mr-1"></i>${item.ownerName || 'Personal'}</span>`
            : `<span class="px-2 py-1 text-xs font-semibold rounded bg-blue-100 text-blue-800"><i class="fas fa-users mr-1"></i>Public</span>`;

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500 font-mono">${item.customId || '-'}</td>
            <td class="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">${item.name}</td>
            <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500">${item.category}</td>
            <td class="px-4 py-3 whitespace-nowrap text-sm">${ownershipBadge}</td>
            <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500 text-center">${item.totalQty}</td>
            <td class="px-4 py-3 whitespace-nowrap text-sm text-center">
                <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${item.availableQty > 0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">
                    ${item.availableQty}
                </span>
            </td>
            <td class="px-4 py-3 whitespace-nowrap">
                <div class="flex justify-center items-center gap-2">
                    <button onclick="viewEquipment('${item.id}')" class="bg-white border border-blue-300 text-blue-700 hover:bg-blue-50 px-3 py-1.5 rounded-md text-sm font-medium transition-colors inline-flex items-center gap-1 shadow-sm">
                        <i class="fas fa-eye"></i> View
                    </button>
                    ${currentUserRole === 'admin' ? `
                    <button onclick="openEditModal('${item.id}')" class="bg-white border border-blue-300 text-blue-700 hover:bg-blue-50 px-3 py-1.5 rounded-md text-sm font-medium transition-colors inline-flex items-center gap-1 shadow-sm">
                        <i class="fas fa-edit"></i> Edit
                    </button>
                    <button onclick="deleteEquipment('${item.id}')" class="bg-white border border-red-300 text-red-700 hover:bg-red-50 px-3 py-1.5 rounded-md text-sm font-medium transition-colors inline-flex items-center gap-1 shadow-sm">
                        <i class="fas fa-trash"></i> Delete
                    </button>
                    ` : ''}
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

window.toggleEditOwnershipFields = function() {
    const ownership = document.querySelector('input[name="edit_ownership"]:checked').value;
    if (ownership === 'Personal') {
        document.getElementById('edit-personal-fields').classList.remove('hidden');
        document.getElementById('edit-public-fields').classList.add('hidden');
    } else {
        document.getElementById('edit-personal-fields').classList.add('hidden');
        document.getElementById('edit-public-fields').classList.remove('hidden');
    }
};

window.openEditModal = async function(id) {
    if (currentUserRole !== 'admin') return;
    const item = equipment.find(e => e.id === id);
    if (!item) return;

    document.getElementById('edit-item-id').value = item.id;
    document.getElementById('edit-item-custom-id').value = item.customId || '';
    document.getElementById('edit-item-name').value = item.name;
    document.getElementById('edit-item-date').value = item.addedOn ? item.addedOn.split('T')[0] : '';
    document.getElementById('edit-item-category').value = item.category || 'Other';
    document.getElementById('edit-item-qty').value = item.totalQty;
    
    // Set Ownership
    if (item.ownership === 'Personal') {
        document.getElementById('edit-own-personal').checked = true;
        document.getElementById('edit-item-owner').value = item.ownerName || item.owner || '';
    } else {
        document.getElementById('edit-own-public').checked = true;
        document.getElementById('edit-item-price').value = item.price || '';
    }
    toggleEditOwnershipFields();
    
    // Clear file inputs
    document.getElementById('edit-item-photos').value = '';
    document.getElementById('edit-item-bill').value = '';

    // Check missing items
    let missingQty = 0;
    checkouts.forEach(c => {
        const i = c.items.find(it => it.equipmentId === id);
        if (i && i.qtyReturned < i.qtyTaken) {
            missingQty += (i.qtyTaken - i.qtyReturned);
        }
    });
    
    const missingContainer = document.getElementById('edit-missing-container');
    if (missingQty > 0) {
        document.getElementById('edit-missing-qty').textContent = missingQty;
        missingContainer.classList.remove('hidden');
    } else {
        missingContainer.classList.add('hidden');
    }

    toggleModal('edit-item-modal');

    // Fetch and display existing photos
    const photosContainer = document.getElementById('edit-current-photos');
    photosContainer.innerHTML = '<div class="text-gray-500 text-sm">Loading...</div>';
    if (item.photoCount && item.photoCount > 0) {
        let imgsHtml = '';
        for (let i = 0; i < item.photoCount; i++) {
            const photoDoc = await getDoc(doc(db, "mediaWingImages", `${id}_photo_${i}`));
            if (photoDoc.exists() && photoDoc.data().data) {
                imgsHtml += `
                <div class="relative inline-block">
                    <img src="${photoDoc.data().data}" class="w-full h-24 object-cover rounded border cursor-pointer hover:opacity-80 transition" onclick="window.open(this.src)">
                    <button type="button" onclick="deleteExistingPhoto('${id}', ${i})" class="absolute top-1 right-1 bg-red-600 text-white rounded-full w-6 h-6 flex items-center justify-center shadow-md hover:bg-red-700 z-10" title="Delete Photo">
                        <i class="fas fa-times text-xs"></i>
                    </button>
                </div>`;
            }
        }
        photosContainer.innerHTML = imgsHtml || '<div class="text-gray-500 text-sm">No existing photos.</div>';
    } else {
        photosContainer.innerHTML = '<div class="text-gray-500 text-sm">No existing photos.</div>';
    }

    // Fetch and display existing bill
    const billContainer = document.getElementById('edit-current-bill');
    if (item.hasBill) {
        billContainer.innerHTML = '<div class="text-gray-500 text-sm">Loading...</div>';
        const billDoc = await getDoc(doc(db, "mediaWingImages", `${id}_bill`));
        if (billDoc.exists() && billDoc.data().data) {
            billContainer.innerHTML = `
            <div class="relative inline-block">
                <img src="${billDoc.data().data}" class="w-32 h-32 object-cover rounded border cursor-pointer hover:opacity-80 transition" onclick="window.open(this.src)">
                <button type="button" onclick="deleteExistingBill('${id}')" class="absolute top-1 right-1 bg-red-600 text-white rounded-full w-6 h-6 flex items-center justify-center shadow-md hover:bg-red-700 z-10" title="Delete Bill">
                    <i class="fas fa-times text-xs"></i>
                </button>
            </div>`;
        } else {
            billContainer.innerHTML = '<div class="text-gray-500 text-sm">No bill attached.</div>';
        }
    } else {
        billContainer.innerHTML = '<div class="text-gray-500 text-sm">No bill attached.</div>';
    }
};

window.deleteExistingPhoto = async function(id, index) {
    if (!confirm("Are you sure you want to delete this photo permanently?")) return;
    try {
        await setDoc(doc(db, "mediaWingImages", `${id}_photo_${index}`), { data: null });
        showToast("Photo deleted.");
        openEditModal(id); // reload modal content
    } catch (e) {
        alert("Failed to delete photo: " + e.message);
    }
};

window.deleteExistingBill = async function(id) {
    if (!confirm("Are you sure you want to delete this bill permanently?")) return;
    try {
        await setDoc(doc(db, "mediaWingImages", `${id}_bill`), { data: null });
        const item = equipment.find(e => e.id === id);
        if (item) {
            item.hasBill = false;
            await saveData();
        }
        showToast("Bill deleted.");
        openEditModal(id); // reload modal content
    } catch (e) {
        alert("Failed to delete bill: " + e.message);
    }
};

window.restoreMissingEquipment = async function() {
    const id = document.getElementById('edit-item-id').value;
    if(!confirm("This will mark all missing units of this equipment as found and returned, making them available in stock again. Proceed?")) return;
    
    // Auto-return all missing of this item across all history
    checkouts.forEach(c => {
        const i = c.items.find(it => it.equipmentId === id);
        if (i && i.qtyReturned < i.qtyTaken) {
            i.qtyReturned = i.qtyTaken; // Restored
        }
    });
    
    // Quick recalculate for UI
    const item = equipment.find(e => e.id === id);
    if(item) {
        let currentlyOut = 0;
        checkouts.forEach(c => {
            const it = c.items.find(x => x.equipmentId === item.id);
            if (it) {
                currentlyOut += (it.qtyTaken - it.qtyReturned);
            }
        });
        item.availableQty = item.totalQty - currentlyOut;
    }
    
    document.getElementById('edit-missing-container').classList.add('hidden');
    updateDashboard();
    renderInventory();
    
    showToast('Missing items marked as found and are now available.');
    await saveData().catch(err => console.error(err));
};

document.getElementById('edit-item-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (currentUserRole !== 'admin') return;

    const id = document.getElementById('edit-item-id').value;
    const item = equipment.find(e => e.id === id);
    if (!item) return;

    const saveBtn = e.target.querySelector('button[type="submit"]');
    const originalBtnHtml = saveBtn.innerHTML;
    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    saveBtn.disabled = true;

    try {
        item.name = document.getElementById('edit-item-name').value.trim();
        item.customId = document.getElementById('edit-item-custom-id').value.trim();
        const editDateStr = document.getElementById('edit-item-date').value;
        if (editDateStr) {
            item.addedOn = new Date(editDateStr).toISOString();
        }
        item.category = document.getElementById('edit-item-category').value;
        
        const ownership = document.querySelector('input[name="edit_ownership"]:checked').value;
        item.ownership = ownership;
        
        if (ownership === 'Personal') {
            item.ownerName = document.getElementById('edit-item-owner').value.trim();
            item.price = 0;
        } else {
            item.price = parseFloat(document.getElementById('edit-item-price').value) || 0;
            item.ownerName = '';
        }
        
        const newTotal = parseInt(document.getElementById('edit-item-qty').value);
        const diff = newTotal - item.totalQty;
        item.totalQty = newTotal;
        item.availableQty += diff;
        if (item.availableQty < 0) item.availableQty = 0;

        // Handle photos
        const photoInput = document.getElementById('edit-item-photos');
        if (photoInput.files.length > 0) {
            const maxPhotos = Math.min(photoInput.files.length, 4);
            const photoBase64Array = [];
            for(let i=0; i<maxPhotos; i++) {
                const b64 = await resizeImage(photoInput.files[i], 800, 800);
                photoBase64Array.push(b64);
            }
            // Save to Firestore Images
            for(let i=0; i<4; i++) {
                const photoDocId = `${id}_photo_${i}`;
                const photoRef = doc(db, "mediaWingImages", photoDocId);
                if(i < photoBase64Array.length) {
                    await setDoc(photoRef, { data: photoBase64Array[i] });
                } else {
                    await setDoc(photoRef, { data: null });
                }
            }
            item.photoCount = photoBase64Array.length;
        }

        // Handle bill
        const billInput = document.getElementById('edit-item-bill');
        if (billInput.files.length > 0) {
            // Can be image or PDF, but resizeImage handles images. If PDF, we might need a generic file reader if we want to store it, but currently the codebase only does resizeImage. 
            // Wait, Add Equipment uses `resizeImage` for bill as well (it assumes image despite accept=".pdf"). I will just keep it identical to what Add Equipment does.
            const billBase64 = await resizeImage(billInput.files[0], 800, 800);
            const billDocId = `${id}_bill`;
            const billRef = doc(db, "mediaWingImages", billDocId);
            await setDoc(billRef, { data: billBase64 });
            item.hasBill = true;
        }

        // Update linked fund expense if public
        if (item.ownership === 'Public') {
            const linkedExpense = fundExpenses.find(fe => fe.linkedEqId === id);
            if (linkedExpense) {
                linkedExpense.amount = parseFloat(item.price || 0);
                linkedExpense.description = `Equipment: ${item.name} (${item.customId})`;
            } else {
                // If they changed Personal -> Public, we create it
                fundExpenses.push({
                    id: 'exp_' + id,
                    amount: parseFloat(item.price || 0),
                    description: `Equipment: ${item.name} (${item.customId})`,
                    date: item.addedOn || new Date().toISOString(),
                    linkedEqId: id
                });
            }
        } else {
            // If they changed Public -> Personal, we remove the expense (because it shouldn't exist)
            // Wait, the user said deleting equipment doesn't refund. But changing Public -> Personal MEANS it was never a public expense. I'll just remove it for consistency, or leave it. Removing it makes sense since it's no longer public.
            fundExpenses = fundExpenses.filter(fe => fe.linkedEqId !== id);
        }

        toggleModal('edit-item-modal');
        updateDashboard();
        renderInventory();
        
        showToast('Equipment updated successfully.');
        await saveData();
    } catch (err) {
        console.error("Error updating equipment:", err);
        alert("Error saving: " + err.message);
    } finally {
        saveBtn.innerHTML = originalBtnHtml;
        saveBtn.disabled = false;
    }
});

window.viewEquipment = async function(id) {
    const item = equipment.find(e => e.id === id);
    if(!item) return;

    document.getElementById('view-title').textContent = item.name;
    document.getElementById('view-content').innerHTML = '<p class="text-center text-gray-500 py-4"><i class="fas fa-spinner fa-spin mr-2"></i>Loading details...</p>';
    toggleModal('view-item-modal');
    
    let content = `
        <div class="mb-4">
            <span class="text-gray-500 text-sm">ID / Serial:</span> <span class="font-medium font-mono">${item.customId || '-'}</span><br>
            <span class="text-gray-500 text-sm">Category:</span> <span class="font-medium">${item.category}</span><br>
            <span class="text-gray-500 text-sm">Total Quantity:</span> <span class="font-medium">${item.totalQty}</span>
        </div>
        <div class="mb-4 border-t pt-4">
            <h4 class="font-semibold text-gray-700 mb-2">Ownership Details</h4>
            <p><span class="text-gray-500 text-sm">Type:</span> ${item.ownership}</p>
    `;

    if (item.ownership === 'Personal') {
        content += `<p><span class="text-gray-500 text-sm">Owner Name:</span> <span class="font-medium">${item.ownerName || 'Not specified'}</span></p>`;
    } else {
        content += `<p><span class="text-gray-500 text-sm">Price:</span> <span class="font-medium">₹${item.price || 'Not specified'}</span></p>`;
        
        if (item.hasBill) {
            try {
                const billDoc = await getDoc(doc(db, "mediaWingImages", id + "_bill"));
                if (billDoc.exists()) {
                    content += `<div class="mt-2"><p class="text-sm text-gray-500 mb-1">Bill/Receipt:</p><img src="${billDoc.data().data}" alt="Bill" class="max-w-full h-auto max-h-48 border rounded shadow-sm mt-2"></div>`;
                }
            } catch(e) {
                console.error("Failed to load bill", e);
            }
        }
    }
    content += `</div>`;

    if (item.photoCount && item.photoCount > 0) {
        content += `
            <div class="mb-4 border-t pt-4">
                <h4 class="font-semibold text-gray-700 mb-2">Product Photo(s)</h4>
                <div class="grid grid-cols-2 gap-2 mt-2">
        `;
        for(let i=0; i<item.photoCount; i++) {
            try {
                const photoDoc = await getDoc(doc(db, "mediaWingImages", `${id}_photo_${i}`));
                if (photoDoc.exists()) {
                    content += `<img src="${photoDoc.data().data}" alt="Product Photo ${i+1}" class="w-full h-auto border rounded shadow-sm">`;
                }
            } catch(e) {
                 console.error("Failed to load photo", e);
            }
        }
        content += `</div></div>`;
    }

    document.getElementById('view-content').innerHTML = content;
}

window.deleteEquipment = function(id) {
    if(confirm('Are you sure you want to delete this equipment?')) {
        const item = equipment.find(e => e.id === id);
        equipment = equipment.filter(e => e.id !== id);
        
        // Optimistic update
        updateDashboard();
        renderInventory();
        showToast('Equipment deleted.');

        // Save in background
        saveData().catch(e => console.error(e));
        
        // Clean up images silently
        if (item.photoCount && item.photoCount > 0) {
            for(let i=0; i<item.photoCount; i++) {
                deleteDoc(doc(db, "mediaWingImages", `${id}_photo_${i}`)).catch(e=>console.log(e));
            }
        } else if (item.hasPhoto) {
            // legacy single photo
            deleteDoc(doc(db, "mediaWingImages", id + "_photo")).catch(e=>console.log(e));
        }
        if(item.hasBill) deleteDoc(doc(db, "mediaWingImages", id + "_bill")).catch(e=>console.log(e));
    }
}

// --- Program Creation Logic ---
document.getElementById('create-program-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('prog-name').value;
    const date = document.getElementById('prog-date').value;

    const newProgram = {
        id: generateId(),
        name,
        date,
        status: 'Active'
    };

    programs.push(newProgram);
    
    checkouts.push({
        programId: newProgram.id,
        items: []
    });

    // Optimistic Update
    updateDashboard();
    toggleModal('create-program-modal');
    e.target.reset();
    showToast('Program created!');
    
    renderCheckoutOptions();
    renderCheckinOptions();

    // Background Save
    saveData().catch(e => console.error(e));
});


// --- Checkout Logic ---
let currentCheckoutCart = [];
let selectedCheckoutProgramId = null;

function renderCheckoutOptions() {
    const progSelect = document.getElementById('checkout-program-select');
    const eqSelect = document.getElementById('checkout-equipment-select');
    
    progSelect.innerHTML = '<option value="">-- Select a Program --</option>';
    programs.filter(p => p.status === 'Active').forEach(p => {
        progSelect.innerHTML += `<option value="${p.id}">${p.name} (${p.date})</option>`;
    });

    eqSelect.innerHTML = '<option value="">-- Select Equipment --</option>';
    equipment.filter(e => e.availableQty > 0).forEach(e => {
        eqSelect.innerHTML += `<option value="${e.id}">${e.name} (Available: ${e.availableQty})</option>`;
    });
}

document.getElementById('checkout-program-select').addEventListener('change', (e) => {
    selectedCheckoutProgramId = e.target.value;
    const section = document.getElementById('checkout-items-section');
    
    if (selectedCheckoutProgramId) {
        section.classList.remove('hidden');
        currentCheckoutCart = [];
        renderAlreadyCheckedOut();
        renderCart();
    } else {
        section.classList.add('hidden');
    }
});

function renderAlreadyCheckedOut() {
    const listEl = document.getElementById('already-checked-out-list');
    const container = document.getElementById('already-checked-out-section');
    
    if (!selectedCheckoutProgramId) return;
    
    const checkoutRecord = checkouts.find(c => c.programId === selectedCheckoutProgramId);
    
    if (!checkoutRecord || checkoutRecord.items.length === 0) {
        container.classList.add('hidden');
        return;
    }
    
    container.classList.remove('hidden');
    listEl.innerHTML = '';
    
    checkoutRecord.items.forEach(item => {
        const eq = equipment.find(e => e.id === item.equipmentId);
        if(!eq) return;
        
        listEl.innerHTML += `
            <li class="p-3 flex justify-between items-center text-sm">
                <span><span class="font-semibold text-gray-800">${eq.name}</span> <span class="text-gray-500 ml-2">Total Taken: ${item.qtyTaken}</span></span>
                <button onclick="removeAlreadyCheckedOut('${eq.id}')" class="text-red-600 hover:text-red-800 text-xs px-3 py-1 bg-white border border-red-200 rounded shadow-sm hover:bg-red-50">
                    <i class="fas fa-trash mr-1"></i> Remove
                </button>
            </li>
        `;
    });
}

window.removeAlreadyCheckedOut = function(eqId) {
    if(!confirm("Are you sure you want to completely remove this item from the program? This will return it to stock.")) return;
    
    const checkoutRecord = checkouts.find(c => c.programId === selectedCheckoutProgramId);
    const itemIndex = checkoutRecord.items.findIndex(i => i.equipmentId === eqId);
    
    if (itemIndex > -1) {
        const itemRecord = checkoutRecord.items[itemIndex];
        const pendingQty = itemRecord.qtyTaken - itemRecord.qtyReturned;
        
        const eq = equipment.find(e => e.id === eqId);
        if (eq && pendingQty > 0) {
            eq.availableQty += pendingQty;
        }
        
        checkoutRecord.items.splice(itemIndex, 1);
        
        updateDashboard();
        renderAlreadyCheckedOut();
        
        // Re-render equipment dropdown but keep program selected
        const currProg = selectedCheckoutProgramId;
        renderCheckoutOptions();
        document.getElementById('checkout-program-select').value = currProg;
        
        showToast('Item removed from program and stock updated.');
        saveData().catch(err => console.error(err));
    }
}

document.getElementById('add-to-checkout-btn').addEventListener('click', () => {
    const eqId = document.getElementById('checkout-equipment-select').value;
    const qty = parseInt(document.getElementById('checkout-qty').value);

    if (!eqId) return alert('Select equipment');
    if (qty < 1) return alert('Quantity must be at least 1');

    const item = equipment.find(e => e.id === eqId);
    
    const existing = currentCheckoutCart.find(i => i.equipmentId === eqId);
    const requestedTotal = existing ? existing.qty + qty : qty;

    if (requestedTotal > item.availableQty) {
        return alert(`Cannot take ${requestedTotal}. Only ${item.availableQty} available.`);
    }

    if (existing) {
        existing.qty += qty;
    } else {
        currentCheckoutCart.push({ equipmentId: eqId, qty, name: item.name });
    }

    renderCart();
});

function renderCart() {
    const cartEl = document.getElementById('checkout-cart');
    const btn = document.getElementById('confirm-checkout-btn');

    if (currentCheckoutCart.length === 0) {
        cartEl.innerHTML = '<li class="text-gray-500 text-sm p-2 text-center" id="empty-cart-msg">No items selected yet.</li>';
        btn.disabled = true;
        return;
    }

    cartEl.innerHTML = '';
    currentCheckoutCart.forEach((item, index) => {
        cartEl.innerHTML += `
            <li class="p-3 flex justify-between items-center text-sm">
                <span><span class="font-semibold">${item.name}</span> x ${item.qty}</span>
                <button onclick="removeFromCart(${index})" class="text-red-500 hover:text-red-700 text-xs"><i class="fas fa-times"></i></button>
            </li>
        `;
    });
    btn.disabled = false;
}

window.removeFromCart = function(index) {
    currentCheckoutCart.splice(index, 1);
    renderCart();
}

document.getElementById('confirm-checkout-btn').addEventListener('click', () => {
    if (!selectedCheckoutProgramId || currentCheckoutCart.length === 0) return;

    const checkoutRecord = checkouts.find(c => c.programId === selectedCheckoutProgramId);
    
    currentCheckoutCart.forEach(cartItem => {
        const eq = equipment.find(e => e.id === cartItem.equipmentId);
        eq.availableQty -= cartItem.qty;

        const existingCheckoutItem = checkoutRecord.items.find(i => i.equipmentId === cartItem.equipmentId);
        if (existingCheckoutItem) {
            existingCheckoutItem.qtyTaken += cartItem.qty;
        } else {
            checkoutRecord.items.push({
                equipmentId: cartItem.equipmentId,
                qtyTaken: cartItem.qty,
                qtyReturned: 0
            });
        }
    });

    // Optimistic Update
    updateDashboard();
    const currProg = selectedCheckoutProgramId;
    currentCheckoutCart = [];
    renderCart();
    renderCheckoutOptions(); 
    
    // Maintain program selection and update lists
    document.getElementById('checkout-program-select').value = currProg;
    selectedCheckoutProgramId = currProg;
    renderAlreadyCheckedOut();

    showToast('Equipment checked out successfully!');

    // Background save
    saveData().catch(e => console.error(e));
});


// --- Check-in Logic ---
let selectedCheckinProgramId = null;

function renderCheckinOptions() {
    const progSelect = document.getElementById('checkin-program-select');
    progSelect.innerHTML = '<option value="">-- Select a Program --</option>';
    programs.filter(p => p.status === 'Active').forEach(p => {
        progSelect.innerHTML += `<option value="${p.id}">${p.name} (${p.date})</option>`;
    });
}

document.getElementById('checkin-program-select').addEventListener('change', (e) => {
    selectedCheckinProgramId = e.target.value;
    const section = document.getElementById('checkin-items-section');
    
    if (selectedCheckinProgramId) {
        section.classList.remove('hidden');
        renderCheckinTable();
    } else {
        section.classList.add('hidden');
    }
});

function renderCheckinTable() {
    const tbody = document.getElementById('checkin-table-body');
    tbody.innerHTML = '';
    
    if(!selectedCheckinProgramId) return;

    const checkoutRecord = checkouts.find(c => c.programId === selectedCheckinProgramId);
    
    if (!checkoutRecord || checkoutRecord.items.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="px-4 py-4 text-center text-gray-500">No items were checked out for this program.</td></tr>';
        return;
    }

    checkoutRecord.items.forEach(item => {
        const eq = equipment.find(e => e.id === item.equipmentId);
        if(!eq) return; 

        const isFullyReturned = item.qtyReturned >= item.qtyTaken;
        
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="px-4 py-3 text-sm font-medium text-gray-900">${eq.name}</td>
            <td class="px-4 py-3 text-sm text-center">${item.qtyTaken}</td>
            <td class="px-4 py-3 text-sm text-center font-bold text-blue-600">${item.qtyReturned}</td>
            <td class="px-4 py-3 text-sm text-center">
                ${isFullyReturned 
                    ? '<span class="text-green-600"><i class="fas fa-check-circle"></i> OK</span>' 
                    : '<span class="text-red-500"><i class="fas fa-exclamation-triangle"></i> Pending</span>'}
            </td>
            <td class="px-4 py-3 whitespace-nowrap">
                <div class="flex justify-center items-center gap-2">
                    <button onclick="openReturnModal('${eq.id}', '${eq.name}', ${item.qtyTaken}, ${item.qtyReturned})" 
                            class="bg-white border px-3 py-1.5 rounded-md text-sm font-medium transition-colors inline-flex items-center gap-1 shadow-sm ${item.qtyReturned > 0 ? 'border-yellow-400 text-yellow-700 hover:bg-yellow-50' : 'border-blue-300 text-blue-700 hover:bg-blue-50'}">
                        ${item.qtyReturned > 0 ? '<i class="fas fa-edit"></i> Edit Return' : '<i class="fas fa-undo"></i> Return'}
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

window.openReturnModal = function(eqId, eqName, taken, returned) {
    document.getElementById('return-prog-id').value = selectedCheckinProgramId;
    document.getElementById('return-eq-id').value = eqId;
    document.getElementById('return-item-name').textContent = eqName;
    document.getElementById('return-item-taken').textContent = taken;
    
    const qtyInput = document.getElementById('return-qty');
    qtyInput.max = taken;
    qtyInput.value = returned; // Pre-fill with current returned quantity

    toggleModal('return-item-modal');
}

document.getElementById('return-item-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const progId = document.getElementById('return-prog-id').value;
    const eqId = document.getElementById('return-eq-id').value;
    const newReturnedQty = parseInt(document.getElementById('return-qty').value);

    const checkoutRecord = checkouts.find(c => c.programId === progId);
    const itemRecord = checkoutRecord.items.find(i => i.equipmentId === eqId);
    
    if (newReturnedQty > itemRecord.qtyTaken || newReturnedQty < 0) {
        return alert('Invalid quantity!');
    }

    const difference = newReturnedQty - itemRecord.qtyReturned;
    
    itemRecord.qtyReturned = newReturnedQty;

    const eq = equipment.find(e => e.id === eqId);
    if (eq) {
        eq.availableQty += difference;
    }

    // Optimistic Update
    updateDashboard();
    toggleModal('return-item-modal');
    renderCheckinTable();
    showToast('Return status updated!');

    // Background Save
    saveData().catch(err => console.error(err));
});

window.removeCheckoutItem = function(eqId) {
    if(!confirm("Are you sure you want to completely remove this item from the program?")) return;
    
    const checkoutRecord = checkouts.find(c => c.programId === selectedCheckinProgramId);
    const itemIndex = checkoutRecord.items.findIndex(i => i.equipmentId === eqId);
    
    if (itemIndex > -1) {
        const itemRecord = checkoutRecord.items[itemIndex];
        const pendingQty = itemRecord.qtyTaken - itemRecord.qtyReturned;
        
        const eq = equipment.find(e => e.id === eqId);
        if (eq && pendingQty > 0) {
            eq.availableQty += pendingQty;
        }
        
        checkoutRecord.items.splice(itemIndex, 1);
        
        updateDashboard();
        renderCheckinTable();
        showToast('Item removed from program.');
        saveData().catch(err => console.error(err));
    }
}

document.getElementById('complete-program-btn').addEventListener('click', () => {
    if(!selectedCheckinProgramId) return;
    
    const checkoutRecord = checkouts.find(c => c.programId === selectedCheckinProgramId);
    const pendingItems = checkoutRecord.items.filter(i => i.qtyReturned < i.qtyTaken);

    if (pendingItems.length > 0) {
        const listEl = document.getElementById('missing-items-list');
        listEl.innerHTML = '';
        pendingItems.forEach(item => {
            const eq = equipment.find(e => e.id === item.equipmentId);
            const eqName = eq ? eq.name : 'Unknown Item';
            const missingQty = item.qtyTaken - item.qtyReturned;
            listEl.innerHTML += `<li><span class="font-semibold">${eqName}</span> (Missing: <span class="text-red-600 font-bold">${missingQty}</span>)</li>`;
        });
        toggleModal('missing-items-modal');
    } else {
        if(!confirm('All items returned! Mark this program as Completed?')) return;
        confirmCompleteWithMissing();
    }
});

window.returnAndCompleteProgram = async function() {
    if(!selectedCheckinProgramId) return;
    const checkoutRecord = checkouts.find(c => c.programId === selectedCheckinProgramId);
    if (!checkoutRecord) return;
    
    // Auto-return all pending
    checkoutRecord.items.forEach(itemRecord => {
        if (itemRecord.qtyReturned < itemRecord.qtyTaken) {
            itemRecord.qtyReturned = itemRecord.qtyTaken;
        }
    });
    
    const prog = programs.find(p => p.id === selectedCheckinProgramId);
    if (prog) prog.status = 'Completed';
    
    updateDashboard();
    renderCheckinOptions();
    document.getElementById('checkin-items-section').classList.add('hidden');
    
    toggleModal('missing-items-modal');
    showToast('All items returned and program completed.');
    await saveData().catch(err => console.error(err));
};

window.confirmCompleteWithMissing = function() {
    if(!selectedCheckinProgramId) return;
    const prog = programs.find(p => p.id === selectedCheckinProgramId);
    if (!prog) return;
    
    prog.status = 'Completed';
    
    updateDashboard();
    renderCheckinOptions();
    document.getElementById('checkin-items-section').classList.add('hidden');
    
    const modal = document.getElementById('missing-items-modal');
    if (!modal.classList.contains('hidden')) {
        toggleModal('missing-items-modal');
    }
    
    showToast('Program completed.');
    saveData().catch(err => console.error(err));
};


function renderHistoryTable(searchTerm = '') {
    const tbody = document.getElementById('history-table-body');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    let completedPrograms = programs.filter(p => p.status === 'Completed');
    
    if (searchTerm) {
        const term = searchTerm.toLowerCase();
        completedPrograms = completedPrograms.filter(p => 
            (p.name && p.name.toLowerCase().includes(term)) || 
            (p.date && p.date.includes(term)) || 
            (p.person && p.person.toLowerCase().includes(term))
        );
    }
    
    completedPrograms.sort((a, b) => new Date(b.date) - new Date(a.date));
    
    if (completedPrograms.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="px-4 py-8 text-center text-gray-500">No completed programs found.</td></tr>`;
        return;
    }
    
    completedPrograms.forEach(prog => {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-gray-50';
        tr.innerHTML = `
            <td class="px-4 py-3 text-sm whitespace-nowrap">${prog.date}</td>
            <td class="px-4 py-3 text-sm font-medium text-gray-900">${prog.name}</td>
            <td class="px-4 py-3 text-sm">${prog.person}</td>
            <td class="px-4 py-3 text-sm text-center">
                <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">Completed</span>
            </td>
            <td class="px-4 py-3 whitespace-nowrap">
                <div class="flex justify-center items-center gap-2">
                    <button onclick="viewHistoryDetails('${prog.id}')" class="bg-white border border-blue-300 text-blue-700 hover:bg-blue-50 px-3 py-1.5 rounded-md text-sm font-medium transition-colors inline-flex items-center gap-1 shadow-sm">
                        <i class="fas fa-eye"></i> View Details
                    </button>
                    ${currentUserRole === 'admin' ? `
                    <button onclick="deleteHistoryProgram('${prog.id}')" class="bg-white border border-red-300 text-red-700 hover:bg-red-50 px-3 py-1.5 rounded-md text-sm font-medium transition-colors inline-flex items-center gap-1 shadow-sm">
                        <i class="fas fa-trash"></i>
                    </button>
                    ` : ''}
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

document.getElementById('search-history')?.addEventListener('input', (e) => {
    renderHistoryTable(e.target.value);
});

window.deleteHistoryProgram = function(progId) {
    if(!confirm("Are you sure you want to permanently delete this program's history? This action cannot be undone.")) return;

    // Remove from checkouts
    const checkoutIndex = checkouts.findIndex(c => c.programId === progId);
    if (checkoutIndex > -1) {
        checkouts.splice(checkoutIndex, 1);
    }

    // Remove from programs
    const progIndex = programs.findIndex(p => p.id === progId);
    if (progIndex > -1) {
        programs.splice(progIndex, 1);
    }

    renderHistoryTable(document.getElementById('search-history')?.value || '');
    updateDashboard(); 
    showToast('Program history deleted successfully.');
    saveData().catch(err => console.error(err));
}

window.viewHistoryDetails = function(progId) {
    const prog = programs.find(p => p.id === progId);
    const checkoutRecord = checkouts.find(c => c.programId === progId);
    
    if (!prog) return;
    
    document.getElementById('history-modal-title').textContent = `${prog.name} (${prog.date})`;
    
    let content = `
        <div class="grid grid-cols-2 gap-4 mb-6 bg-gray-50 p-4 rounded-lg border">
            <div><span class="text-gray-500 text-sm">Location:</span> <br><span class="font-medium">${prog.location || 'N/A'}</span></div>
            <div><span class="text-gray-500 text-sm">In Charge:</span> <br><span class="font-medium">${prog.person || 'N/A'}</span></div>
            <div class="col-span-2"><span class="text-gray-500 text-sm">Description:</span> <br><span>${prog.desc || 'None'}</span></div>
        </div>
    `;
    
    if (checkoutRecord && checkoutRecord.items && checkoutRecord.items.length > 0) {
        content += `
            <h4 class="font-semibold text-gray-800 mb-3 border-b pb-2">Equipment Details</h4>
            <div class="overflow-x-auto">
                <table class="w-full text-left border-collapse border border-gray-200">
                    <thead>
                        <tr class="bg-gray-100 text-gray-700 text-sm">
                            <th class="px-3 py-2 border-b">Item Name</th>
                            <th class="px-3 py-2 border-b text-center">Qty Taken</th>
                            <th class="px-3 py-2 border-b text-center">Qty Returned</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-gray-200">
        `;
        
        checkoutRecord.items.forEach(item => {
            const eq = equipment.find(e => e.id === item.equipmentId);
            const eqName = eq ? eq.name : 'Unknown Item';
            content += `
                <tr class="hover:bg-gray-50">
                    <td class="px-3 py-2 text-sm font-medium text-gray-900">${eqName}</td>
                    <td class="px-3 py-2 text-sm text-center">${item.qtyTaken}</td>
                    <td class="px-3 py-2 text-sm text-center text-green-600 font-semibold">${item.qtyReturned}</td>
                </tr>
            `;
        });
        
        content += `
                    </tbody>
                </table>
            </div>
        `;
    } else {
        content += `<p class="text-gray-500 italic">No equipment was taken for this program.</p>`;
    }
    
    document.getElementById('history-modal-content').innerHTML = content;
    toggleModal('view-history-modal');
}

// Check auth and initialize app
checkAuth();
// --- Fund Management Logic ---

function renderFundsTab() {
    if (currentUserRole !== 'admin') return; // Extra safety

    let totalCollected = 0;
    const additionsBody = document.getElementById('fund-additions-body');
    additionsBody.innerHTML = '';

    // Sort by date descending
    const sortedAdditions = [...fundAdditions].sort((a, b) => new Date(b.date) - new Date(a.date));

    sortedAdditions.forEach(f => {
        totalCollected += parseFloat(f.amount);
        additionsBody.innerHTML += `
            <tr class="hover:bg-gray-50">
                <td class="px-4 py-3 text-sm text-gray-700">${new Date(f.date).toLocaleDateString()}</td>
                <td class="px-4 py-3 text-sm font-medium text-gray-900">${f.source}</td>
                <td class="px-4 py-3 text-sm font-bold text-green-600 text-right">₹${f.amount.toLocaleString()}</td>
                <td class="px-4 py-3 text-sm text-center">
                    <button onclick="editFundAddition('${f.id}')" class="text-blue-500 hover:text-blue-700 mr-2" title="Edit Fund"><i class="fas fa-edit"></i></button>
                    <button onclick="deleteFundAddition('${f.id}')" class="text-red-500 hover:text-red-700" title="Delete Fund"><i class="fas fa-trash-alt"></i></button>
                </td>
            </tr>
        `;
    });

    if (sortedAdditions.length === 0) {
        additionsBody.innerHTML = '<tr><td colspan="4" class="px-4 py-3 text-sm text-center text-gray-500">No funds added yet.</td></tr>';
    }

    let totalSpent = 0;
    const usageBody = document.getElementById('fund-usage-body');
    usageBody.innerHTML = '';

    // Sort by date descending
    const sortedExpenses = [...fundExpenses].sort((a, b) => new Date(b.date) - new Date(a.date));

    sortedExpenses.forEach(exp => {
        const price = parseFloat(exp.amount || 0);
        totalSpent += price;
        usageBody.innerHTML += `
            <tr class="hover:bg-gray-50">
                <td class="px-4 py-3 text-sm text-gray-700">${exp.date ? new Date(exp.date).toLocaleDateString() : 'N/A'}</td>
                <td class="px-4 py-3 text-sm font-medium text-gray-900">${exp.description}</td>
                <td class="px-4 py-3 text-sm font-bold text-red-600 text-right">₹${price.toLocaleString()}</td>
                <td class="px-4 py-3 text-sm text-center">
                    <button onclick="editFundExpense('${exp.id}')" class="text-blue-500 hover:text-blue-700 mr-2" title="Edit Expense"><i class="fas fa-edit"></i></button>
                    <button onclick="deleteFundExpense('${exp.id}')" class="text-red-500 hover:text-red-700" title="Delete Expense"><i class="fas fa-trash-alt"></i></button>
                </td>
            </tr>
        `;
    });

    if (sortedExpenses.length === 0) {
        usageBody.innerHTML = '<tr><td colspan="4" class="px-4 py-3 text-sm text-center text-gray-500">No expenses recorded yet.</td></tr>';
    }

    const available = totalCollected - totalSpent;

    document.getElementById('fund-total-collected').textContent = '₹' + totalCollected.toLocaleString();
    document.getElementById('fund-total-spent').textContent = '₹' + totalSpent.toLocaleString();
    
    const balanceEl = document.getElementById('fund-available-balance');
    balanceEl.textContent = '₹' + available.toLocaleString();
    if (available < 0) {
        balanceEl.classList.remove('text-blue-600');
        balanceEl.classList.add('text-red-600');
    } else {
        balanceEl.classList.add('text-blue-600');
        balanceEl.classList.remove('text-red-600');
    }
}

// --- Add Fund ---
document.getElementById('add-fund-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (currentUserRole !== 'admin') return;

    const amount = parseFloat(document.getElementById('fund-amount').value);
    const source = document.getElementById('fund-source').value.trim();
    if (!amount || amount <= 0) return alert("Enter a valid amount.");

    const newFund = { id: 'fund_' + Date.now(), amount, source, date: new Date().toISOString() };
    fundAdditions.push(newFund);
    
    toggleModal('add-fund-modal');
    document.getElementById('add-fund-form').reset();
    renderFundsTab();
    showToast('Fund added successfully!');
    saveData().catch(console.error);
});

// --- Edit/Delete Fund ---
window.editFundAddition = function(id) {
    const f = fundAdditions.find(x => x.id === id);
    if(!f) return;
    document.getElementById('edit-fund-id').value = id;
    document.getElementById('edit-fund-amount').value = f.amount;
    document.getElementById('edit-fund-source').value = f.source;
    toggleModal('edit-fund-modal');
};

document.getElementById('edit-fund-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('edit-fund-id').value;
    const f = fundAdditions.find(x => x.id === id);
    if(f) {
        f.amount = parseFloat(document.getElementById('edit-fund-amount').value);
        f.source = document.getElementById('edit-fund-source').value.trim();
        toggleModal('edit-fund-modal');
        renderFundsTab();
        showToast('Fund updated.');
        saveData().catch(console.error);
    }
});

window.deleteFundAddition = async function(id) {
    if (!confirm("Are you sure you want to delete this fund entry? This will reduce the available balance.")) return;
    fundAdditions = fundAdditions.filter(f => f.id !== id);
    renderFundsTab();
    showToast('Fund entry deleted.');
    await saveData().catch(e => console.error(e));
};

// --- Add Expense ---
document.getElementById('add-expense-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (currentUserRole !== 'admin') return;

    const amount = parseFloat(document.getElementById('expense-amount').value);
    const source = document.getElementById('expense-source').value.trim();
    if (!amount || amount <= 0) return alert("Enter a valid amount.");

    const newExp = { id: 'exp_manual_' + Date.now(), amount, description: source, date: new Date().toISOString() };
    fundExpenses.push(newExp);
    
    toggleModal('add-expense-modal');
    document.getElementById('add-expense-form').reset();
    renderFundsTab();
    showToast('Expense added successfully!');
    saveData().catch(console.error);
});

// --- Edit/Delete Expense ---
window.editFundExpense = function(id) {
    const exp = fundExpenses.find(x => x.id === id);
    if(!exp) return;
    document.getElementById('edit-expense-id').value = id;
    document.getElementById('edit-expense-amount').value = exp.amount;
    document.getElementById('edit-expense-source').value = exp.description;
    toggleModal('edit-expense-modal');
};

document.getElementById('edit-expense-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('edit-expense-id').value;
    const exp = fundExpenses.find(x => x.id === id);
    if(exp) {
        exp.amount = parseFloat(document.getElementById('edit-expense-amount').value);
        exp.description = document.getElementById('edit-expense-source').value.trim();
        toggleModal('edit-expense-modal');
        renderFundsTab();
        showToast('Expense updated.');
        saveData().catch(console.error);
    }
});

window.deleteFundExpense = async function(id) {
    if (!confirm("Are you sure you want to delete this expense? This will INCREASE the available balance.")) return;
    fundExpenses = fundExpenses.filter(f => f.id !== id);
    renderFundsTab();
    showToast('Expense deleted.');
    await saveData().catch(e => console.error(e));
};
