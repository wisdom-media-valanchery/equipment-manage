// --- State Management ---
let equipment = [];
let programs = [];
let checkouts = [];

// Initialize localForage (IndexedDB wrapper)
localforage.config({
    name: 'MediaWingManager'
});

async function initData() {
    try {
        const storedEq = await localforage.getItem('media_equipment');
        const storedProg = await localforage.getItem('media_programs');
        const storedCheck = await localforage.getItem('media_checkouts');
        
        equipment = storedEq || [];
        programs = storedProg || [];
        checkouts = storedCheck || [];
        
        updateDashboard();
        renderInventory();
    } catch (err) {
        console.error("Error loading data from IndexedDB", err);
    }
}

async function saveData() {
    try {
        await localforage.setItem('media_equipment', equipment);
        await localforage.setItem('media_programs', programs);
        await localforage.setItem('media_checkouts', checkouts);
        updateDashboard();
    } catch (err) {
        console.error("Error saving data", err);
    }
}

// Generate unique ID
function generateId() {
    return Math.random().toString(36).substr(2, 9);
}

// Helper: Convert File to Base64 String
function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        if (!file) return resolve(null);
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
        reader.readAsDataURL(file);
    });
}

// --- Navigation Logic ---
const navLinks = document.querySelectorAll('.nav-link');
const sections = document.querySelectorAll('.content-section');

navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        const targetId = link.getAttribute('data-target');
        
        // Update active nav
        navLinks.forEach(n => n.classList.remove('active', 'border-l-4', 'border-blue-500'));
        link.classList.add('active');

        // Update active section
        sections.forEach(s => s.classList.add('hidden'));
        document.getElementById(targetId).classList.remove('hidden');

        // Trigger specific logic on tab load
        if(targetId === 'inventory') renderInventory();
        if(targetId === 'checkout') renderCheckoutOptions();
        if(targetId === 'checkin') renderCheckinOptions();
    });
});

// Mobile menu toggle
document.getElementById('mobile-menu-btn').addEventListener('click', () => {
    const sidebar = document.querySelector('aside');
    sidebar.classList.toggle('hidden');
    sidebar.classList.toggle('absolute');
    sidebar.classList.toggle('z-40');
    sidebar.classList.toggle('h-full');
});

// --- Modal Logic ---
function toggleModal(modalId) {
    const modal = document.getElementById(modalId);
    modal.classList.toggle('hidden');
}

function toggleOwnershipFields() {
    const ownership = document.querySelector('input[name="ownership"]:checked').value;
    if (ownership === 'Personal') {
        document.getElementById('personal-fields').classList.remove('hidden');
        document.getElementById('public-fields').classList.add('hidden');
    } else {
        document.getElementById('personal-fields').classList.add('hidden');
        document.getElementById('public-fields').classList.remove('hidden');
    }
}

// --- Toast Notifications ---
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

// --- Dashboard Logic ---
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
    submitBtn.textContent = 'Saving...';

    const name = document.getElementById('eq-name').value;
    const category = document.getElementById('eq-category').value;
    const qty = parseInt(document.getElementById('eq-qty').value);
    const ownership = document.querySelector('input[name="ownership"]:checked').value;
    
    // Optional Fields
    const photoFile = document.getElementById('eq-photo').files[0];
    const photoBase64 = await fileToBase64(photoFile);

    let price = '';
    let billBase64 = null;
    let ownerName = '';

    if (ownership === 'Public') {
        price = document.getElementById('eq-price').value;
        const billFile = document.getElementById('eq-bill').files[0];
        billBase64 = await fileToBase64(billFile);
    } else {
        ownerName = document.getElementById('eq-owner').value;
    }

    const newItem = {
        id: generateId(),
        name,
        category,
        totalQty: qty,
        availableQty: qty,
        ownership,
        ownerName,
        price,
        photo: photoBase64,
        bill: billBase64
    };

    equipment.push(newItem);
    await saveData();
    
    renderInventory();
    toggleModal('add-item-modal');
    e.target.reset();
    toggleOwnershipFields(); // reset visibility
    
    submitBtn.disabled = false;
    submitBtn.textContent = 'Save Item';
    showToast('Equipment added successfully!');
});

function renderInventory() {
    const tbody = document.getElementById('inventory-table-body');
    tbody.innerHTML = '';

    if (equipment.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="px-6 py-4 text-center text-gray-500">No equipment found. Add some!</td></tr>';
        return;
    }

    equipment.forEach(item => {
        let ownershipBadge = item.ownership === 'Personal' 
            ? `<span class="px-2 py-1 text-xs font-semibold rounded bg-yellow-100 text-yellow-800"><i class="fas fa-user mr-1"></i>${item.ownerName || 'Personal'}</span>`
            : `<span class="px-2 py-1 text-xs font-semibold rounded bg-blue-100 text-blue-800"><i class="fas fa-users mr-1"></i>Public</span>`;

        const tr = document.createElement('tr');
        tr.innerHTML = `
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

function viewEquipment(id) {
    const item = equipment.find(e => e.id === id);
    if(!item) return;

    document.getElementById('view-title').textContent = item.name;
    
    let content = `
        <div class="mb-4">
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
        if(item.bill) {
            // Check if PDF or Image
            if(item.bill.startsWith('data:application/pdf')) {
                content += `<div class="mt-2"><a href="${item.bill}" download="${item.name}_bill.pdf" class="text-blue-600 hover:underline"><i class="fas fa-download"></i> Download Bill (PDF)</a></div>`;
            } else {
                content += `<div class="mt-2"><p class="text-sm text-gray-500 mb-1">Bill/Receipt:</p><img src="${item.bill}" alt="Bill" class="max-w-full h-auto max-h-48 border rounded shadow-sm"></div>`;
            }
        }
    }
    content += `</div>`;

    if (item.photo) {
        content += `
            <div class="mb-4 border-t pt-4">
                <h4 class="font-semibold text-gray-700 mb-2">Product Photo</h4>
                <img src="${item.photo}" alt="Product Photo" class="max-w-full h-auto max-h-64 border rounded shadow-sm">
            </div>
        `;
    }

    document.getElementById('view-content').innerHTML = content;
    toggleModal('view-item-modal');
}

async function deleteEquipment(id) {
    if(confirm('Are you sure you want to delete this equipment?')) {
        equipment = equipment.filter(e => e.id !== id);
        await saveData();
        renderInventory();
        showToast('Equipment deleted.');
    }
}

// --- Program Creation Logic ---
document.getElementById('create-program-form').addEventListener('submit', async (e) => {
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
    
    // Create empty checkout record
    checkouts.push({
        programId: newProgram.id,
        items: []
    });

    await saveData();
    toggleModal('create-program-modal');
    e.target.reset();
    showToast('Program created!');
    
    // Refresh selects
    renderCheckoutOptions();
    renderCheckinOptions();
});


// --- Checkout Logic ---
let currentCheckoutCart = [];
let selectedCheckoutProgramId = null;

function renderCheckoutOptions() {
    const progSelect = document.getElementById('checkout-program-select');
    const eqSelect = document.getElementById('checkout-equipment-select');
    
    // Populate active programs
    progSelect.innerHTML = '<option value="">-- Select a Program --</option>';
    programs.filter(p => p.status === 'Active').forEach(p => {
        progSelect.innerHTML += `<option value="${p.id}">${p.name} (${p.date})</option>`;
    });

    // Populate available equipment
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
        currentCheckoutCart = []; // Reset cart for new program selection
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
    
    // Check if already in cart
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
    const emptyMsg = document.getElementById('empty-cart-msg');
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

function removeFromCart(index) {
    currentCheckoutCart.splice(index, 1);
    renderCart();
}

document.getElementById('confirm-checkout-btn').addEventListener('click', async () => {
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

    await saveData();
    currentCheckoutCart = [];
    renderCart();
    renderCheckoutOptions(); 
    showToast('Equipment checked out successfully!');
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

function openReturnModal(eqId, eqName, taken, returned) {
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

document.getElementById('return-item-form').addEventListener('submit', async (e) => {
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

    await saveData();
    toggleModal('return-item-modal');
    renderCheckinTable();
    showToast(`${returnQty}x ${eq.name} returned!`);
});

document.getElementById('complete-program-btn').addEventListener('click', async () => {
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
    await saveData();
    
    renderCheckinOptions();
    document.getElementById('checkin-items-section').classList.add('hidden');
    showToast('Program marked as completed.');
});


// Initialize app
initData();
