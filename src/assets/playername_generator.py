import json
import random
import uuid

# --- DEEP NAME POOLS ---

WESTERN_FIRST = [
    # Standard Common
    "James", "John", "Robert", "Michael", "William", "David", "Richard", "Joseph", "Thomas", "Charles", 
    "Matthew", "Anthony", "Mark", "Steven", "Andrew", "Kenneth", "Joshua", "Kevin", "Brian", "George", 
    "Edward", "Ronald", "Timothy", "Jason", "Jeffrey", "Ryan", "Jacob", "Gary", "Nicholas", "Eric", 
    "Jonathan", "Stephen", "Larry", "Justin", "Scott", "Brandon", "Benjamin", "Samuel", "Gregory", "Alexander", 
    "Patrick", "Jack", "Dennis", "Tyler", "Aaron", "Adam", "Henry", "Nathan", "Douglas", "Zachary",
    "Christopher", "Paul", "Sean", "Colin", "Nolan", "Bryce", "Austin", "Dylan", "Logan", "Caleb",
    "Hunter", "Christian", "Wyatt", "Carter", "Luke", "Isaac", "Jayden", "Mason", "Elijah", "Julian",
    "Levi", "Isaiah", "Josiah", "Cody", "Kyle", "Bradley", "Derek", "Trevor", "Victor",
    "Marcus", "Peter", "Blake", "Chase", "Cole", "Harrison", "Weston", "Declan", "Evan", "Maxwell",
    "Spencer", "Gavin", "Owen", "Jared", "Brett", "Clayton", "Garrett", "Dalton", "Miles", "Cooper",
    # Less Common / Baseball Vibe
    "Silas", "Jaxon", "Colton", "Brody", "Ryder", "Waylon", "Beau", "Judson", "Zane", "Maddox",
    "Jace", "Rowen", "Kyler", "Beckett", "Hayes", "Nash", "Knox", "Holden", "Lane", "Reid",
    "Dallas", "Cash", "Rhett", "Bowen", "Tucker", "Corbin", "Easton", "Camden", "Gage", "Jett"
]

WESTERN_LAST = [
    # Standard Common
    "Smith", "Johnson", "Williams", "Brown", "Jones", "Miller", "Davis", "Wilson", "Anderson", "Thomas", 
    "Taylor", "Moore", "Jackson", "Martin", "White", "Harris", "Clark", "Lewis", "Robinson", "Walker", 
    "Young", "Allen", "King", "Wright", "Scott", "Hill", "Green", "Adams", "Nelson", "Baker", 
    "Hall", "Campbell", "Mitchell", "Carter", "Roberts", "Phillips", "Evans", "Turner", "Parker", "Edwards", 
    "Collins", "Stewart", "Morris", "Murphy", "Cook", "Rogers", "Morgan", "Peterson", "Cooper", "Reed",
    "Bailey", "Bell", "Gomez", "Kelly", "Howard", "Ward", "Cox", "Diaz", "Richardson", "Wood",
    "Watson", "Brooks", "Bennett", "Gray", "James", "Reyes", "Cruz", "Hughes", "Price", "Myers",
    "Long", "Foster", "Sanders", "Ross", "Morales", "Powell", "Sullivan", "Russell", "Ortiz", "Jenkins",
    "Gutierrez", "Perry", "Butler", "Barnes", "Fisher", "Henderson", "Coleman", "Simmons", "Patterson", "Jordan",
    "Reynolds", "Hamilton", "Graham", "Kim", "Gonzales", "Alexander", "Ramos", "Wallace", "Griffin", "West",
    # Less Common / Baseball Vibe
    "Whitmore", "Sinclair", "Gallagher", "Callahan", "Montgomery", "Sterling", "Prescott", "Langdon", "Carmichael", "Harrington",
    "Faulkner", "Delaney", "Mercer", "Vance", "Thorne", "Hawthorne", "Beaumont", "Winslow", "Copeland", "Lancaster",
    "Calhoun", "Dempsey", "Garrison", "Hastings", "Strickland", "MacMillan", "Holloway", "Whitaker", "Bradford", "Carver"
]

HISPANIC_FIRST = [
    "Mateo", "Santiago", "Matias", "Sebastian", "Benjamin", "Martin", "Nicolas", "Alejandro", "Lucas", "Diego", 
    "Daniel", "Joaquin", "Tomas", "Gabriel", "Emiliano", "Luis", "Felipe", "Carlos", "Juan", "Miguel", 
    "Javier", "Jose", "Fernando", "Jorge", "Ricardo", "Eduardo", "Raul", "Hector", "Julio", "Victor",
    "Andres", "Manuel", "Pedro", "Roberto", "Alfonso", "Guillermo", "Rafael", "Oscar", "Pablo", "Mario",
    "Arturo", "Hugo", "Ignacio", "Cesar", "Ivan", "Cristian", "Marcos", "Ruben", "Emanuel", "Salvador"
]

HISPANIC_LAST = [
    "Garcia", "Martinez", "Rodriguez", "Lopez", "Hernandez", "Gonzalez", "Perez", "Sanchez", "Ramirez", "Torres", 
    "Flores", "Rivera", "Gomez", "Diaz", "Cruz", "Reyes", "Morales", "Ortiz", "Gutierrez", "Chavez", 
    "Ruiz", "Alvarez", "Fernandez", "Jimenez", "Moreno", "Romero", "Herrera", "Medina", "Aguilar", "Vargas",
    "Castillo", "Mendez", "Salazar", "Soto", "Franco", "Dominguez", "Rios", "Silva", "Peña", "Valdez",
    "Mendoza", "Cortez", "Guzman", "Muñoz", "Rojas", "Navarro", "Delgado", "Vega", "Cabrera", "Campos"
]

DUTCH_FIRST = [
    "Johannes", "Hendrik", "Cornelis", "Jan", "Willem", "Pieter", "Dirk", "Albertus", "Gerrit", "Jacobus", 
    "Lars", "Bram", "Thijs", "Ruben", "Daan", "Luuk", "Milan", "Levi", "Sem", "Finn",
    "Jeroen", "Bas", "Maarten", "Arjen", "Sven", "Niels", "Koen", "Tim", "Bart", "Rick",
    "Martijn", "Sander", "Jasper", "Stefan", "Joost", "Klaas", "Wouter", "Michiel", "Erwin", "Joris"
]

DUTCH_LAST = [
    "De Jong", "Jansen", "De Vries", "Van den Berg", "Van Dijk", "Bakker", "Visser", "Smit", "Meijer", "De Boer", 
    "Van der Meer", "Bos", "Vos", "Peters", "Hendriks", "Van Leeuwen", "Dekker", "Brouwer", "De Groot", "Gerritsen",
    "Mulder", "Kuipers", "Veenstra", "Jonker", "Van Doorn", "Prins", "Kramer", "Scholten", "Post", "Vink",
    "Timmermans", "Groen", "Koster", "Willems", "Evers", "Hoekstra", "Maas", "Ruiter", "Schutte", "Vermeulen"
]

JAPANESE_FIRST = [
    "Hiroshi", "Minoru", "Makoto", "Kenji", "Takashi", "Akira", "Shigeru", "Yutaka", "Mamoru", "Shohei", 
    "Ichiro", "Hideki", "Kenta", "Masahiro", "Tetsuya", "Kazuo", "Yoshi", "Noboru", "Taro", "Daiki",
    "Yuki", "Ryota", "Koji", "Takuya", "Shin", "Yuta", "Naoto", "Keisuke", "Haruto", "Sota",
    "Riku", "Ren", "Hinata", "Ryu", "Satoshi", "Jun", "Masato", "Hiroki", "Ryo", "Seiji"
]

JAPANESE_LAST = [
    "Sato", "Suzuki", "Takahashi", "Tanaka", "Watanabe", "Ito", "Yamamoto", "Nakamura", "Kobayashi", "Kato", 
    "Yoshida", "Yamada", "Sasaki", "Yamaguchi", "Matsumoto", "Inoue", "Kimura", "Hayashi", "Shimizu", "Yamazaki",
    "Nakajima", "Ogawa", "Okada", "Hasegawa", "Murakami", "Kondo", "Ishii", "Saito", "Fukuda", "Ota",
    "Fujita", "Morita", "Endo", "Nakano", "Matsuda", "Kojima", "Maeda", "Fujiwara", "Uchida", "Goto"
]

KOREAN_FIRST = [
    "Min-ho", "Ji-hoon", "Hyun-woo", "Seo-joon", "Do-yoon", "Joo-won", "Eun-woo", "Si-woo", "Ha-joon", "Gun-woo", 
    "Dong-hyun", "Sung-min", "Jung-hoon", "Tae-hyung", "Jae-sung", "Seung-ho", "Ki-bum", "Dong-yoon", "Chan-woo", "Joon-ho",
    "Kyung-soo", "Sang-hoon", "Ye-joon", "Woo-jin", "Min-jun", "Ji-ho", "Seo-jin", "Joo-hyuk", "Sung-woo", "Kwang-soo"
]

KOREAN_LAST = [
    "Kim", "Lee", "Park", "Choi", "Jung", "Kang", "Cho", "Yoon", "Jang", "Lim", 
    "Han", "Shin", "Oh", "Seo", "Kwon", "Hwang", "Ahn", "Song", "Jeon", "Bae",
    "Baek", "Ryu", "Nam", "Go", "Moon"
]

CHINESE_FIRST = [
    "Wei", "Hao", "Yu", "Jie", "Xin", "Jian", "Peng", "Bo", "Ming", "Jun", 
    "Cheng", "Lei", "Feng", "Ping", "Zhi", "Qiang", "Tao", "Chao", "Dong", "Liang",
    "Hua", "Bin", "Ning", "Shan", "Yang", "Long", "Kun", "Fan", "Yuan", "Fei"
]

CHINESE_LAST = [
    "Wang", "Li", "Zhang", "Liu", "Chen", "Yang", "Huang", "Zhao", "Wu", "Zhou", 
    "Xu", "Sun", "Ma", "Zhu", "Hu", "Lin", "Guo", "He", "Gao", "Liang",
    "Zheng", "Luo", "Song", "Xie", "Tang"
]

# Global set to track exact full names and ensure zero duplicates
generated_full_names = set()

def get_unique_name():
    while True:
        rand_heritage = random.random()
        
        # Determine heritage and name mixing
        if rand_heritage < 0.50:
            # 50% Western Heritage
            first = random.choice(WESTERN_FIRST)
            last = random.choice(WESTERN_LAST)
        elif rand_heritage < 0.70:
            # 20% Hispanic Heritage (30% chance of a Western first name)
            first = random.choice(WESTERN_FIRST) if random.random() < 0.3 else random.choice(HISPANIC_FIRST)
            last = random.choice(HISPANIC_LAST)
        elif rand_heritage < 0.80:
            # 10% Dutch Heritage (30% chance of a Western first name)
            first = random.choice(WESTERN_FIRST) if random.random() < 0.3 else random.choice(DUTCH_FIRST)
            last = random.choice(DUTCH_LAST)
        elif rand_heritage < 0.90:
            # 10% Japanese Heritage (30% chance of a Western first name)
            first = random.choice(WESTERN_FIRST) if random.random() < 0.3 else random.choice(JAPANESE_FIRST)
            last = random.choice(JAPANESE_LAST)
        elif rand_heritage < 0.95:
            # 5% Korean Heritage (30% chance of a Western first name)
            first = random.choice(WESTERN_FIRST) if random.random() < 0.3 else random.choice(KOREAN_FIRST)
            last = random.choice(KOREAN_LAST)
        else:
            # 5% Chinese Heritage (30% chance of a Western first name)
            first = random.choice(WESTERN_FIRST) if random.random() < 0.3 else random.choice(CHINESE_FIRST)
            last = random.choice(CHINESE_LAST)

        full_name = f"{first} {last}"
        
        # Verify uniqueness
        if full_name not in generated_full_names:
            generated_full_names.add(full_name)
            return first, last

def generate_player(league_id):
    first, last = get_unique_name()

    # Position & Player Type
    if random.random() < 0.45:
        p_type = 'pitcher'
        prim_pos = random.choice(['SP', 'SP', 'RP', 'RP', 'CL']) 
    else:
        p_type = 'batter'
        prim_pos = random.choice(['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'])

    # Age & Status
    age = int(random.gauss(27, 4.5))
    age = max(18, min(42, age))
    
    if age <= 22:
        status = random.choice(['prospect', 'active'])
    elif age >= 38:
        status = random.choice(['active', 'free_agent', 'retired'])
    else:
        status = random.choice(['active', 'active', 'free_agent'])
        
    years_pro = max(0, age - random.randint(18, 22)) if status != 'prospect' else 0

    return {
        "player_id": str(uuid.uuid4()),
        "league_id": league_id,
        "first_name": first,
        "last_name": last,
        "player_type": p_type,
        "primary_position": prim_pos,
        "secondary_position": None,
        "bats": random.choice(['L', 'R', 'R', 'S']),
        "throws": random.choice(['L', 'R', 'R', 'R']),
        "age": age,
        "potential": round(random.uniform(0.40, 0.99), 3),
        "status": status,
        "draft_class_year": 2026 - years_pro if years_pro > 0 else None,
        "draft_round": random.randint(1, 30) if status != 'prospect' else None,
        "years_pro": years_pro,
        "retirement_year": 2026 if status == 'retired' else None
    }

# Execution
target_league_id = str(uuid.uuid4())
players_data = [generate_player(target_league_id) for _ in range(900)]

with open('players_900_deep_pool.json', 'w', encoding='utf-8') as f:
    json.dump(players_data, f, indent=4, ensure_ascii=False)

print(f"✅ Successfully generated 900 unique players with expanded, uncommon Western names.")