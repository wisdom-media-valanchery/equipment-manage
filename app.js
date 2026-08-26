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

// --- State Management ---
let equipment = [];
let programs = [];
let checkouts = [];

async function initData() {
    try {
        const docRef = doc(db, "mediaWing", "mainData");
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
            const data = docSnap.data();
            equipment = data.equipment || [];
            programs = data.programs || [];
            checkouts = data.checkouts || [];
        } else {
            setDoc(docRef, { equipment: [], programs: [], checkouts: [] });
        }
        
        updateDashboard();
        renderInventory();
    } catch (err) {
        console.error("Error loading data from Firebase", err);
        showToast('Error loading data from server.', 'error');
    }
}

async function saveData() {
    try {
        const docRef = doc(db, "mediaWing", "mainData");
        await setDoc(docRef, {
            equipment,
            programs,
            checkouts
        });
        // We do NOT call updateDashboard here anymore, 
        // we call it instantly before saveData.
    } catch (err) {
        console.error("Error saving data to Firebase", err);
        showToast('Error syncing with server.', 'error');
        throw err;
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
        if(targetId === 'checkout') renderCheckoutOptions();
        if(targetId === 'checkin') renderCheckinOptions();
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
    document.getElementById('stat-active-programs').textContent = activeProgs;
    document.getElementById('stat-items-out').textContent = itemsOut;
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
            hasBill
        };

        equipment.push(newItem);
        
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
            <td class="px-4 py-3 whitespace-nowrap text-sm text-center space-x-2">
                <button onclick="viewEquipment('${item.id}')" class="text-blue-600 hover:text-blue-900" title="View Details"><i class="fas fa-eye"></i></button>
                <button onclick="deleteEquipment('${item.id}')" class="text-red-600 hover:text-red-900" title="Delete"><i class="fas fa-trash"></i></button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

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
        renderCart();
    } else {
        section.classList.add('hidden');
    }
});

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
    currentCheckoutCart = [];
    renderCart();
    renderCheckoutOptions(); 
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
            <td class="px-4 py-3 text-sm text-center">
                <button onclick="openReturnModal('${eq.id}', '${eq.name}', ${item.qtyTaken}, ${item.qtyReturned})" 
                        class="bg-blue-100 text-blue-700 px-2 py-1 rounded text-xs hover:bg-blue-200 ${isFullyReturned ? 'opacity-50 cursor-not-allowed' : ''}" 
                        ${isFullyReturned ? 'disabled' : ''}>
                    Return
                </button>
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
    document.getElementById('return-item-already').textContent = returned;
    
    const maxReturnable = taken - returned;
    const qtyInput = document.getElementById('return-qty');
    qtyInput.max = maxReturnable;
    qtyInput.value = maxReturnable;

    toggleModal('return-item-modal');
}

document.getElementById('return-item-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const progId = document.getElementById('return-prog-id').value;
    const eqId = document.getElementById('return-eq-id').value;
    const returnQty = parseInt(document.getElementById('return-qty').value);

    const checkoutRecord = checkouts.find(c => c.programId === progId);
    const itemRecord = checkoutRecord.items.find(i => i.equipmentId === eqId);
    
    if (returnQty > (itemRecord.qtyTaken - itemRecord.qtyReturned)) {
        return alert('Cannot return more than taken!');
    }

    itemRecord.qtyReturned += returnQty;

    const eq = equipment.find(e => e.id === eqId);
    eq.availableQty += returnQty;

    // Optimistic Update
    updateDashboard();
    toggleModal('return-item-modal');
    renderCheckinTable();
    showToast(`${returnQty}x ${eq.name} returned!`);

    // Background Save
    saveData().catch(err => console.error(err));
});

document.getElementById('complete-program-btn').addEventListener('click', () => {
    if(!selectedCheckinProgramId) return;
    
    const checkoutRecord = checkouts.find(c => c.programId === selectedCheckinProgramId);
    const hasPendingItems = checkoutRecord.items.some(i => i.qtyReturned < i.qtyTaken);

    if (hasPendingItems) {
        if(!confirm('There are still items pending return! Are you sure you want to close this program? This will mark it as Completed, but items won\'t be returned to inventory automatically.')) {
            return;
        }
    } else {
        if(!confirm('All items returned! Mark this program as Completed?')) return;
    }

    const prog = programs.find(p => p.id === selectedCheckinProgramId);
    prog.status = 'Completed';
    
    // Optimistic Update
    updateDashboard();
    renderCheckinOptions();
    document.getElementById('checkin-items-section').classList.add('hidden');
    showToast('Program marked as completed.');

    // Background Save
    saveData().catch(err => console.error(err));
});


// Initialize app from Firebase
initData();
