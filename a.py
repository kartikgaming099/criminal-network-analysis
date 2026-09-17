import pandas as pd
import networkx as nx
import matplotlib.pyplot as plt
import glob

print("=======================================================")
print(" SIH26189: THE UNIVERSAL 'NO-RULES' DISCOVERY ENGINE ")
print("=======================================================")

# 1. Automatically find ALL CSV files in the folder
csv_files = glob.glob("*.csv")

if len(csv_files) == 0:
    print("ERROR: No CSV files found in this folder.")
    exit()

print("\nFound these datasets in your folder:")
for i, file in enumerate(csv_files):
    print(f"  [{i + 1}] {file}")

choice = input(f"\nSelect the dataset number (1 to {len(csv_files)}): ")

try:
    file_index = int(choice) - 1
    file_name = csv_files[file_index]
    df = pd.read_csv(file_name)
    print(f"\nSuccessfully loaded '{file_name}'!")
except (ValueError, IndexError):
    print("ERROR: Invalid selection.")
    exit()

print("\nStep 2: Blindly scanning EVERY cell for hidden connections...")
G = nx.Graph()

# 2. THE UNIVERSAL LINKER
# We iterate through the file row by row. 
for index, row in df.iterrows():
    row_data = []
    
    # We scrape every single column in the file without knowing their names
    for col in df.columns:
        cell_value = str(row[col]).strip()
        
        # Skip empty cells or generic "nan" data
        if cell_value.lower() not in ["nan", "none", "", "null"]:
            
            # If a cell has multiple items (like a list of names separated by commas), we split them
            items = [item.strip() for item in cell_value.split(",") if item.strip()]
            row_data.extend(items)
    
    # Remove any accidental duplicates within the exact same row
    row_data = list(set(row_data))
    
    # Add every piece of data we found as a node on the map
    for item in row_data:
        G.add_node(item)
        
    # The Magic Step: Connect everything in this row to everything else in this row!
    # If a bank account and a phone number appear in the same row, they get linked.
    if len(row_data) > 1:
        for i in range(len(row_data)):
            for j in range(i + 1, len(row_data)):
                G.add_edge(row_data[i], row_data[j])

print(f"\nDiscovered: {G.number_of_nodes()} unique entities and {G.number_of_edges()} connections.")
print("Step 3: Opening the interactive network map window...")

# 3. Draw the map
plt.figure(figsize=(14, 10))

# The spring layout naturally pulls connected syndicates together and pushes isolated data away
pos = nx.spring_layout(G, k=0.35, seed=42)

# We use a lower alpha (transparency) so you can see the dense webs easily
nx.draw(G, pos, with_labels=True, node_size=600, node_color="cyan", font_size=7, font_weight="bold", edge_color="gray", alpha=0.8)
plt.title(f"SIH26189 Universal AI: Discovering Hidden Links in {file_name}", fontsize=16)

plt.show()