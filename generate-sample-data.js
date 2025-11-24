const fs = require('fs');
const path = require('path');

const sampleItems = [
    { name: "Ski Pass - Vail Resort", description: "Full-season pass for Vail Resort. Includes unlimited skiing and snowboarding access to all Vail properties.", winningNumber: "1234" },
    { name: "Burton Snowboard Package", description: "Premium Burton snowboard with bindings and boots. Perfect for advanced riders looking for top-tier equipment.", winningNumber: "5678" },
    { name: "GoPro Hero 12", description: "Latest GoPro action camera with accessories. Capture all your extreme sports moments in stunning 4K quality.", winningNumber: "9012" },
    { name: "Patagonia Winter Jacket", description: "High-performance insulated winter jacket. Waterproof, breathable, and designed for extreme conditions.", winningNumber: null },
    { name: "Ski Tune-Up Package", description: "Professional ski and snowboard tuning service. Includes waxing, edge sharpening, and base repair.", winningNumber: "3456" },
    { name: "Oakley Goggles & Helmet", description: "Premium Oakley snow goggles paired with a certified safety helmet. Complete protection and style.", winningNumber: null },
    { name: "Yeti Cooler - 45qt", description: "Heavy-duty Yeti cooler for all your outdoor adventures. Keeps ice frozen for days.", winningNumber: "7890" },
    { name: "North Face Backpack", description: "Durable 30L backpack perfect for backcountry skiing or day trips. Multiple compartments and hydration compatible.", winningNumber: null },
    { name: "Concert VIP Tickets", description: "VIP tickets to the main stage concert featuring headlining acts. Includes backstage meet and greet.", winningNumber: "2345" },
    { name: "Snowboard Lessons Package", description: "5 private lessons with a certified instructor. Perfect for beginners or those looking to improve their skills.", winningNumber: null },
    { name: "Après Ski Gift Basket", description: "Premium gift basket with craft beers, artisan chocolates, and gourmet snacks. Perfect for relaxing after a day on the slopes.", winningNumber: "6789" },
    { name: "Ski Poles - Carbon Fiber", description: "Ultra-lightweight carbon fiber ski poles. Adjustable length and ergonomic grips.", winningNumber: null },
    { name: "Heated Gloves Set", description: "Battery-powered heated gloves with multiple heat settings. Stay warm even on the coldest days.", winningNumber: "0123" },
    { name: "REI Gift Card - $500", description: "Five hundred dollar gift card to REI. Use it for any outdoor gear or equipment.", winningNumber: "4567" },
    { name: "Weekend Lodge Stay", description: "Two-night stay at a luxury mountain lodge. Includes breakfast and hot tub access.", winningNumber: null },
    { name: "Avalanche Safety Course", description: "Professional avalanche safety training course. Includes beacon, probe, and shovel training.", winningNumber: "8901" },
    { name: "Drone with Camera", description: "DJI Mini 3 Pro drone with 4K camera. Capture stunning aerial footage of your adventures.", winningNumber: null },
    { name: "Hydro Flask Bundle", description: "Complete Hydro Flask bundle with multiple sizes. Keeps drinks hot or cold for hours.", winningNumber: "2468" },
    { name: "Ski Rack for Vehicle", description: "Premium roof-mounted ski rack. Fits up to 6 pairs of skis or 4 snowboards.", winningNumber: null },
    { name: "Mountain Bike - Full Suspension", description: "High-end full suspension mountain bike. Perfect for summer trail riding when the snow melts.", winningNumber: "1357" }
];

const colors = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8',
    '#F7DC6F', '#BB8FCE', '#85C1E2', '#F8B739', '#52B788',
    '#E63946', '#A8DADC', '#457B9D', '#F4A261', '#2A9D8F',
    '#E76F51', '#8338EC', '#FF006E', '#FB5607', '#FFB703'
];

// Create placeholder images using Canvas-like SVG
function createPlaceholderImage(color, index) {
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="600" height="400" xmlns="http://www.w3.org/2000/svg">
    <rect width="600" height="400" fill="${color}"/>
    <text x="50%" y="50%" font-family="Arial, sans-serif" font-size="48" font-weight="bold"
          fill="white" text-anchor="middle" dominant-baseline="middle" opacity="0.8">
        RAFFLE ITEM ${index + 1}
    </text>
</svg>`;
    return svg;
}

// Create directories if they don't exist
if (!fs.existsSync('data')) {
    fs.mkdirSync('data');
}

if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
}

// Generate sample data
const raffles = sampleItems.map((item, index) => {
    const imageFilename = `sample-${Date.now()}-${index}.svg`;
    const imagePath = path.join(__dirname, 'uploads', imageFilename);

    // Create SVG placeholder image
    const svg = createPlaceholderImage(colors[index], index);
    fs.writeFileSync(imagePath, svg);

    return {
        id: Date.now() + index,
        name: item.name,
        description: item.description,
        image: '/uploads/' + imageFilename,
        winningNumber: item.winningNumber,
        createdAt: new Date(Date.now() - (20 - index) * 60000).toISOString()
    };
});

// Write to data file
const dataFile = path.join(__dirname, 'data', 'raffles.json');
fs.writeFileSync(dataFile, JSON.stringify(raffles, null, 2));

console.log('✅ Successfully created 20 sample raffle items!');
console.log(`📊 Data saved to: ${dataFile}`);
console.log(`🖼️  Images saved to: uploads/`);
console.log('\nSample winning numbers for testing:');
console.log('- 1234 (Ski Pass)');
console.log('- 5678 (Burton Snowboard)');
console.log('- 9012 (GoPro)');
console.log('- 3456 (Ski Tune-Up)');
console.log('- 7890 (Yeti Cooler)');
console.log('- 2345 (Concert Tickets)');
console.log('- 6789 (Gift Basket)');
console.log('- 0123 (Heated Gloves)');
console.log('- 4567 (REI Gift Card)');
console.log('- 8901 (Avalanche Course)');
console.log('- 2468 (Hydro Flask)');
console.log('- 1357 (Mountain Bike)');
console.log('\nTry entering multiple numbers like: 1234, 5678, 9012');
