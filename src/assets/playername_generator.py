import json
import random
import uuid

# --- MASSIVE NAME POOLS ---

WESTERN_FIRST = [
    # --- WESTERN BLACK (African American & Cultural) ---
    "DeAndre", "DeShawn", "Jamal", "Malik", "Trevon", "Tyrese", "Tyrone", "Darnell", "Marquis", "Terrell", 
    "Tremaine", "DeMarcus", "Kendrick", "Tariq", "Omari", "Jalen", "Darius", "Rashad", "Deon", "Kevon", 
    "Devonte", "Trayvon", "Lamarcus", "Jaquan", "D'Angelo", "Keyshawn", "Daunte", "Raheem", "Jabari", "Kahlil",
    "Khalil", "Lamar", "Desmond", "Demario", "Deangelo", "Tyrell", "Javon", "Jamar", "Kareem", "Antwan",
    "Damarcus", "Dequan", "Treyvon", "Davion", "Tyriek", "Darius", "Donte", "Trevion", "Tyshawn", "Kwame",

    # --- WESTERN SLAVIC (Common in the US/Western Leagues) ---
    "Ivan", "Boris", "Vladimir", "Igor", "Nikolai", "Dimitri", "Milan", "Novak", "Luka", "Sasha", 
    "Milos", "Goran", "Stefan", "Dragan", "Bogdan", "Vlad", "Sergei", "Anton", "Yuri", "Pavel", 
    "Roman", "Mikhail", "Aleksei", "Stanislav", "Maksim", "Ilija", "Darko", "Marko", "Zoltan", "Marek",

    # --- WESTERN ABBREVIATED (Initials) ---
    "AJ", "CJ", "DJ", "JJ", "JR", "JT", "RJ", "TJ", "KC", "MJ", 
    "PJ", "BJ", "JC", "DC", "TC", "KD", "JD", "JP", "OJ", "VJ",

    # --- STANDARD COMMON (A-Z Expanded) ---
    # A
    "Aaron", "Abraham", "Adam", "Adrian", "Aidan", "Alan", "Albert", "Alec", "Alex", "Alexander", 
    "Allen", "Alton", "Alvin", "Amos", "Andre", "Andrew", "Andy", "Anthony", "Archer", "Archie", 
    "Arthur", "Asher", "Ashton", "August", "Austin", "Avery", "Axel",
    # B
    "Bailey", "Barry", "Bart", "Beau", "Beck", "Beckett", "Ben", "Benjamin", "Bennett", "Benson", 
    "Bentley", "Bernard", "Bill", "Billy", "Blaine", "Blake", "Bo", "Bob", "Bobby", "Bodhi", 
    "Brad", "Bradley", "Brady", "Brandon", "Brantley", "Braxton", "Brayden", "Brendan", "Brennan", 
    "Brent", "Brett", "Brian", "Brice", "Brock", "Brody", "Bronson", "Brooks", "Bruce", "Bryan", 
    "Bryant", "Bryce", "Bryson", "Buck", "Buddy", "Burt", "Buster", "Byron",
    # C
    "Cade", "Caden", "Caleb", "Callum", "Calvin", "Camden", "Cameron", "Carl", "Carlos", "Carson", 
    "Carter", "Case", "Cash", "Cason", "Cassius", "Cecil", "Cedric", "Chad", "Chance", "Chandler", 
    "Charles", "Charlie", "Chase", "Chester", "Chris", "Christian", "Christopher", "Chuck", 
    "Clarence", "Clark", "Clay", "Clayton", "Clifford", "Clifton", "Clint", "Clinton", "Clyde", 
    "Cody", "Cohen", "Colby", "Cole", "Colin", "Collin", "Colt", "Colton", "Conner", "Connor", 
    "Conrad", "Cooper", "Corbin", "Corey", "Cory", "Craig", "Creed", "Crew", "Cruz", "Cullen", "Curtis", "Cyrus",
    # D
    "Dakota", "Dale", "Dallas", "Dalton", "Damian", "Damien", "Damon", "Dan", "Dane", "Daniel", 
    "Danny", "Dante", "Darian", "Darien", "Darin", "Darius", "Darnell", "Darrell", "Darren", 
    "Darryl", "Darwin", "Dash", "Dave", "David", "Davin", "Davis", "Dawson", "Dax", "Daxton", 
    "Dayton", "Dean", "Declan", "Demetrius", "Denis", "Dennis", "Denver", "Derek", "Derrick", 
    "Desmond", "Devin", "Devon", "Dexter", "Diego", "Dillon", "Dion", "Dirk", "Dixon", "Dominic", 
    "Dominick", "Don", "Donald", "Donovan", "Dorian", "Doug", "Douglas", "Drake", "Drew", 
    "Duane", "Duke", "Duncan", "Dustin", "Dusty", "Dwayne", "Dwight", "Dylan",
    # E
    "Earl", "Easton", "Ed", "Eddie", "Edgar", "Edison", "Edmund", "Eduardo", "Edward", "Edwin", 
    "Eli", "Elias", "Elijah", "Elliot", "Elliott", "Ellis", "Elmer", "Elton", "Elvin", "Elvis", 
    "Emanuel", "Emerson", "Emery", "Emil", "Emiliano", "Emmanuel", "Emmett", "Emmitt", "Emory", 
    "Enoch", "Enrique", "Enzo", "Ephraim", "Eric", "Erich", "Erick", "Erik", "Ernest", "Ernie", 
    "Erwin", "Esteban", "Ethan", "Eugene", "Evan", "Everett", "Ezekiel", "Ezra",
    # F
    "Fabian", "Felipe", "Felix", "Fernando", "Finn", "Finnegan", "Finnley", "Fisher", "Fletcher", 
    "Flint", "Floyd", "Flynn", "Ford", "Forest", "Forrest", "Foster", "Fox", "Francesco", "Francis", 
    "Francisco", "Frank", "Frankie", "Franklin", "Fred", "Freddie", "Freddy", "Frederick", "Fredrick",
    # G
    "Gabe", "Gabriel", "Gage", "Gale", "Galen", "Gannon", "Gareth", "Garett", "Garret", "Garrett", 
    "Garrick", "Garrison", "Garry", "Garth", "Gary", "Gatlin", "Gavin", "Gene", "Geoffrey", "George", 
    "Gerald", "Gerard", "Gerardo", "Gilbert", "Gilberto", "Giles", "Gino", "Giovanni", "Glen", 
    "Glenn", "Gordon", "Grady", "Graham", "Grant", "Grayson", "Greg", "Gregg", "Gregory", "Grey", 
    "Greyson", "Griffin", "Grover", "Guillermo", "Gunnar", "Gunner", "Gus", "Guy",
    # H
    "Hank", "Harlan", "Harley", "Harold", "Harper", "Harrison", "Harry", "Harvey", "Hassan", 
    "Hayden", "Hayes", "Heath", "Hector", "Hendrix", "Henrik", "Henry", "Herbert", "Herman", 
    "Homer", "Horace", "Houston", "Howard", "Hudson", "Hugh", "Hugo", "Humberto", "Hunter", "Huxley",
    # I
    "Ian", "Ibrahim", "Ignacio", "Igor", "Ira", "Irvin", "Irving", "Isaac", "Isaak", "Isaiah", 
    "Isaias", "Ishmael", "Isiah", "Isidro", "Ismael", "Israel", "Issac", "Ivan", "Izaiah",
    # J
    "Jace", "Jack", "Jackie", "Jackson", "Jacob", "Jacoby", "Jaden", "Jadon", "Jagger", "Jaiden", 
    "Jaime", "Jalen", "Jamal", "Jamari", "James", "Jameson", "Jamie", "Jamison", "Jared", "Jase", 
    "Jason", "Jasper", "Javier", "Javon", "Jax", "Jaxon", "Jaxson", "Jay", "Jayce", "Jaycob", 
    "Jayden", "Jaylen", "Jayson", "Jeb", "Jed", "Jedidiah", "Jefferson", "Jeffery", "Jeffrey", 
    "Jeremiah", "Jeremy", "Jermaine", "Jerome", "Jerry", "Jesse", "Jessie", "Jesus", "Jett", 
    "Jim", "Jimmie", "Jimmy", "Joaquin", "Joe", "Joel", "Joey", "Johan", "John", "Johnathan", 
    "Johnathon", "Johnny", "Jon", "Jonah", "Jonas", "Jonathan", "Jonathon", "Jordan", "Jordon", 
    "Jorge", "Jose", "Josef", "Joseph", "Josh", "Joshua", "Josiah", "Josue", "Juan", "Judah", 
    "Jude", "Judson", "Jules", "Julian", "Julien", "Julio", "Julius", "Junior", "Justice", "Justin", "Justus",
    # K
    "Kade", "Kaden", "Kai", "Kaiden", "Kale", "Kaleb", "Kameron", "Kamden", "Kane", "Kareem", 
    "Karl", "Karson", "Karter", "Kase", "Kasen", "Kash", "Kason", "Kayden", "Keanu", "Keaton", 
    "Keegan", "Keenan", "Keith", "Kellan", "Kellen", "Kelvin", "Kendrick", "Kenji", "Kennedy", 
    "Kenneth", "Kenny", "Kent", "Kenyon", "Keon", "Kevin", "Kian", "Kieran", "Killian", "King", 
    "Kingston", "Kip", "Kirby", "Kirk", "Kiyan", "Knox", "Kobe", "Koby", "Kody", "Kohen", "Kole", 
    "Kolton", "Korbin", "Kory", "Kraig", "Kris", "Kristian", "Kristopher", "Kruz", "Kurt", "Kurtis", 
    "Kye", "Kylan", "Kyle", "Kyler", "Kyree",
    # L
    "Lachlan", "Lamar", "Lambert", "Lance", "Landen", "Landon", "Landry", "Lane", "Langston", 
    "Larry", "Lars", "Laurence", "Lawrence", "Lawson", "Layne", "Layton", "Lazaro", "Leandro", 
    "Lee", "Legend", "Leif", "Leigh", "Leighton", "Leland", "Lemuel", "Lennon", "Lennox", "Leo", 
    "Leon", "Leonard", "Leonardo", "Leonel", "Leonidas", "Leopold", "Leroy", "Les", "Lester", 
    "Levi", "Lewis", "Liam", "Lincoln", "Lindell", "Linden", "Linus", "Lionel", "Lloyd", "Lochlan", 
    "Logan", "London", "Lonnie", "Lorenzo", "Louie", "Louis", "Lowell", "Luc", "Luca", "Lucas", 
    "Lucian", "Luciano", "Lucius", "Lucky", "Luigi", "Luis", "Luka", "Lukas", "Luke", "Luther", 
    "Lyle", "Lyman", "Lyndon", "Lynn",
    # M
    "Mac", "Macaulay", "Mack", "Macon", "Madden", "Maddox", "Maddux", "Magnus", "Major", "Makai", 
    "Malachi", "Malachy", "Malcolm", "Malik", "Malloy", "Manfred", "Manny", "Manuel", "Marc", 
    "Marcel", "Marcellus", "Marcelo", "Marco", "Marcos", "Marcus", "Mario", "Marion", "Mark", 
    "Markel", "Markus", "Marlin", "Marlon", "Marques", "Marquis", "Marshall", "Martin", "Marty", 
    "Marvin", "Mason", "Massimo", "Mat", "Mateo", "Mathew", "Mathias", "Matt", "Matteo", "Matthew", 
    "Matthias", "Maurice", "Mauricio", "Maverick", "Max", "Maxim", "Maximilian", "Maximiliano", 
    "Maximo", "Maximus", "Maxwell", "Mayer", "Maynard", "Mccoy", "Mekhi", "Mel", "Melvin", "Memphis", 
    "Mercer", "Merle", "Merlin", "Merrill", "Merritt", "Meyer", "Micah", "Michael", "Micheal", 
    "Michel", "Mickey", "Miguel", "Mike", "Mikel", "Milan", "Miles", "Milford", "Miller", "Milo", 
    "Milton", "Misael", "Mitch", "Mitchell", "Monroe", "Monte", "Montgomery", "Monty", "Moore", 
    "Morgan", "Morris", "Mortimer", "Morton", "Moses", "Murphy", "Murray", "Myles", "Myron",
    # N
    "Nash", "Nasir", "Nate", "Nathan", "Nathanael", "Nathaniel", "Neal", "Ned", "Nehemiah", "Neil", 
    "Nelson", "Nestor", "Nevan", "Nevin", "Newton", "Nicholas", "Nick", "Nickolas", "Nico", 
    "Nicolas", "Nigel", "Nikko", "Niko", "Nikolai", "Nikolas", "Niles", "Nils", "Nixon", "Noah", 
    "Noble", "Noel", "Nolan", "Norberto", "Norman", "Norm", "Norris", "North", "Norton", "Norwood", "Nova",
    # O
    "Oakley", "Oakes", "Obadiah", "Ocean", "Octavio", "Odell", "Odin", "Ogden", "Oliver", "Ollie", 
    "Omar", "Omari", "Orion", "Orlando", "Orson", "Orval", "Orville", "Osbaldo", "Osborn", "Osborne", 
    "Oscar", "Osvaldo", "Oswaldo", "Otis", "Otto", "Owen", "Ozzie", "Ozzy",
    # P
    "Pablo", "Pace", "Paco", "Paddy", "Padraig", "Palmer", "Parker", "Pascal", "Patrick", "Paul", 
    "Paulie", "Paxton", "Payton", "Pearce", "Pedro", "Penn", "Percy", "Perry", "Pete", "Peter", 
    "Peyton", "Phil", "Philip", "Phillip", "Phineas", "Phoenix", "Pierce", "Pierre", "Piers", 
    "Porter", "Prentiss", "Prescott", "Preston", "Price", "Prince", "Princeton",
    # Q
    "Quadir", "Quinton", "Quintin", "Quinn", "Quincy", "Quigley", "Quentin", "Quenten",
    # R
    "Ralph", "Ramsey", "Randal", "Randall", "Randell", "Randolph", "Randy", "Raphael", "Rashad", 
    "Raul", "Ray", "Rayan", "Rayburn", "Raymon", "Raymond", "Raymundo", "Reagan", "Reece", "Reed", 
    "Reese", "Reggie", "Reginald", "Reid", "Reinaldo", "Remi", "Remington", "Remy", "Rene", "Reno", 
    "Reuben", "Rex", "Rey", "Reynaldo", "Rhett", "Rhys", "Ricardo", "Richard", "Richie", "Richmond", 
    "Rick", "Rickey", "Rickie", "Ricky", "Rico", "Ridge", "Rigoberto", "Riley", "Rio", "River", 
    "Roan", "Rob", "Robbie", "Robby", "Robert", "Roberto", "Robin", "Rocco", "Rocky", "Rod", 
    "Roderick", "Rodney", "Rodolfo", "Rodrick", "Rodrigo", "Rogelio", "Roger", "Rohan", "Roland", 
    "Rolando", "Roman", "Romeo", "Ron", "Ronald", "Ronan", "Ronin", "Ronnie", "Ronny", "Roosevelt", 
    "Rory", "Roscoe", "Ross", "Rowan", "Rowen", "Roy", "Royal", "Royce", "Ruben", "Rubin", "Rudy", 
    "Rufus", "Rupert", "Russel", "Russell", "Rusty", "Ryan", "Ryder", "Ryker", "Rylan", "Ryland",
    # S
    "Sabastian", "Sage", "Saint", "Sal", "Salvador", "Salvatore", "Sam", "Samir", "Samson", "Samuel", 
    "Santiago", "Santino", "Santos", "Saul", "Sawyer", "Scott", "Scottie", "Scotty", "Seamus", "Sean", 
    "Sebastian", "Sebastien", "Selwyn", "Semaj", "Seneca", "Sergio", "Seth", "Seamus", "Seymour", 
    "Shamus", "Shane", "Shannon", "Shaun", "Shaw", "Shawn", "Shay", "Shayne", "Shea", "Sheldon", 
    "Shelton", "Shem", "Shepherd", "Sherman", "Shiloh", "Shon", "Sidney", "Silas", "Simon", "Sincere", 
    "Skylar", "Skyler", "Slade", "Slater", "Sol", "Solomon", "Sonny", "Soren", "Spencer", "Stan", 
    "Stanford", "Stanley", "Stanton", "Stefan", "Stephan", "Stephen", "Stephon", "Sterling", "Steve", 
    "Steven", "Stevie", "Stewart", "Stone", "Storm", "Stuart", "Sullivan", "Sutton", "Sven", "Sylas", "Sylvester",
    # T
    "Tad", "Taggart", "Taj", "Talon", "Tanner", "Tariq", "Tate", "Tatum", "Tavian", "Taylor", "Teagan", 
    "Ted", "Teddy", "Teo", "Terence", "Terrance", "Terrell", "Terrence", "Terry", "Thad", "Thaddeus", 
    "Thatcher", "Theo", "Theodore", "Thiago", "Thom", "Thomas", "Thor", "Thorn", "Thornton", "Thurston", 
    "Tiago", "Tiberius", "Tiger", "Tillman", "Tim", "Timmy", "Timothy", "Tito", "Titus", "Tobias", 
    "Tobin", "Toby", "Tod", "Todd", "Tomas", "Tommy", "Tony", "Townes", "Townsend", "Trace", "Tracy", 
    "Travis", "Trayvon", "Tre", "Trent", "Trenton", "Trevion", "Trevor", "Trey", "Treyton", "Trinidad", 
    "Trinity", "Tripp", "Tristan", "Tristen", "Tristian", "Tristin", "Triston", "Troy", "True", "Truman", 
    "Tucker", "Tullio", "Tully", "Turner", "Ty", "Tyce", "Tyler", "Tylor", "Tyree", "Tyrell", "Tyrese", 
    "Tyrone", "Tyshaun", "Tyson", "Tyrus",
    # U-V
    "Ulises", "Ulysses", "Uriah", "Uriel", "Val", "Valentin", "Valentine", "Valentino", "Van", "Vance", 
    "Vaughn", "Vern", "Vernon", "Vic", "Vicente", "Victor", "Vidas", "Vince", "Vincent", "Vincenzo", 
    "Vinson", "Virgil", "Vito", "Von",
    # W
    "Wade", "Walker", "Wallace", "Wally", "Walter", "Walton", "Ward", "Warren", "Watson", "Waylon", 
    "Wayne", "Weaver", "Webb", "Webster", "Weldon", "Wellington", "Wells", "Wendell", "Werner", "Wes", 
    "Wesley", "Wesson", "West", "Westbrook", "Weston", "Wheeler", "Whit", "Whitaker", "Wilber", 
    "Wilbert", "Wilbur", "Wilden", "Wilder", "Wiley", "Wilfred", "Wilfredo", "Will", "Willem", 
    "William", "Williams", "Willie", "Willis", "Wilmer", "Wilson", "Wilton", "Windsor", "Winston", 
    "Winter", "Wolf", "Wolfgang", "Wood", "Woodrow", "Woods", "Woodson", "Woody", "Wright", "Wyatt", "Wylie",
    # X-Z
    "Xander", "Xavier", "Xavi", "Xzavier", "Zac", "Zach", "Zachariah", "Zachary", "Zachery", "Zack", 
    "Zackary", "Zackery", "Zaid", "Zaiden", "Zain", "Zaire", "Zak", "Zander", "Zane", "Zavier", "Zayd", 
    "Zayden", "Zayn", "Zeb", "Zebulon", "Zechariah", "Zed", "Zeke", "Zephaniah", "Zeppelin", "Zeus", 
    "Ziggy", "Zion", "Ziya", "Zolt", "Zoltan"
]

WESTERN_LAST = [
    # Standard Common (Anglo-American)
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
    # Less Common / Old School Baseball Vibe
    "Whitmore", "Sinclair", "Gallagher", "Callahan", "Montgomery", "Sterling", "Prescott", "Langdon", "Carmichael", "Harrington",
    "Faulkner", "Delaney", "Mercer", "Vance", "Thorne", "Hawthorne", "Beaumont", "Winslow", "Copeland", "Lancaster",
    "Calhoun", "Dempsey", "Garrison", "Hastings", "Strickland", "MacMillan", "Holloway", "Whitaker", "Bradford", "Carver",
    "Boudreaux", "Clement", "Fontenot", "Landry", "Thibodeaux", "Benton", "Blackburn", "Caldwell", "Donovan", "Fletcher",
    "Gallant", "Hammond", "Ingram", "Kearney", "Lombardi", "Manning", "Neville", "Ogden", "Pruitt", "Quinn",
    # Irish & Scottish
    "O'Connor", "O'Brien", "O'Neill", "Fitzgerald", "MacDonald", "MacLeod", "Murray", "Doherty", "Sweeney", "Brennan",
    "Doyle", "Farrell", "Kavanagh", "Fraser", "MacKenzie", "Cameron", "Douglas", "Crawford", "McIntyre", "Buchanan",
    "MacKinnon", "O'Donnell", "O'Sullivan", "O'Keefe", "O'Riley", "O'Shea", "McCarthy", "McGrath", "McMahon", "McSweeney",
    # Scandinavian
    "Jensen", "Nielsen", "Hansen", "Pedersen", "Lund", "Lindberg", "Nygaard", "Larsen", "Sorensen", "Rasmussen",
    "Holm", "Berg", "Olsen", "Johansen", "Knutsen", "Lind", "Dahl", "Strand", "Bakken", "Solberg",
    "Gustafsson", "Karlsson", "Svensson", "Nilsson", "Larsson", "Eriksson", "Persson", "Olsson", "Jansson", "Gunnarsson",
    # Slavic
    "Ivanov", "Smirnov", "Novak", "Kowalski", "Wisniewski", "Kaminski", "Petrov", "Sokolov", "Popov", "Lebedev",
    "Volkov", "Morozov", "Kozlov", "Sikora", "Stepien", "Kravchenko", "Shevchenko", "Dvorak", "Horak", "Polak",
    "Bogdanov", "Pavlov", "Orlov", "Markov", "Zaytsev", "Zielinski", "Szymanski", "Wojcik", "Dabrowski", "Zimmerman"
]

HISPANIC_FIRST = [
    # Your Original Base
    "Mateo", "Santiago", "Matias", "Sebastian", "Benjamin", "Martin", "Nicolas", "Alejandro", "Lucas", "Diego", 
    "Daniel", "Joaquin", "Tomas", "Gabriel", "Emiliano", "Luis", "Felipe", "Carlos", "Juan", "Miguel", 
    "Javier", "Jose", "Fernando", "Jorge", "Ricardo", "Eduardo", "Raul", "Hector", "Julio", "Victor",
    "Andres", "Manuel", "Pedro", "Roberto", "Alfonso", "Guillermo", "Rafael", "Oscar", "Pablo", "Mario",
    "Arturo", "Hugo", "Ignacio", "Cesar", "Ivan", "Cristian", "Marcos", "Ruben", "Emanuel", "Salvador",
    "Ronald", "Yordan", "Vladimir", "Wander", "Manny", "Eloy", "Ozzie", "Francisco", "Amed", "Teoscar",
    "Ketel", "Starling", "Cesar", "Gleyber", "Eugenio", "Eduardo", "Avisail", "Marcell", "Nelson", "Ramon",
    "Sandy", "Framber", "Cristian", "Camilo", "Edwin", "Aroldis", "Raisel", "Gregory", "Felix", "Domingo",
    "Yasmani", "Willson", "Salvador", "Gary", "Christian", "Javier", "Geraldo", "Orlando", "Enrique", "Mauricio",
    
    # Expanded Deep Pool (A-M)
    "Abner", "Adalberto", "Adonis", "Adrian", "Agustin", "Alberto", "Aldo", "Alexis", "Alfredo", "Alonso",
    "Alvaro", "Amado", "Angel", "Antonio", "Ariel", "Armando", "Augusto", "Aurelio", "Bartolo", "Basilio",
    "Benito", "Bernardo", "Braulio", "Brayan", "Bruno", "Carmelo", "Christopher", "Claudio", "Clemente", "Damian",
    "Danilo", "Danny", "Dario", "David", "Dennis", "Edgar", "Edison", "Efrain", "Elias", "Eliezer",
    "Eliseo", "Elmer", "Emilio", "Emmanuel", "Enzo", "Erick", "Ernesto", "Esteban", "Eusebio", "Ezequiel",
    "Fabian", "Facundo", "Federico", "Fermin", "Fidel", "Flavio", "Franco", "Frank", "Franklin", "Freddy",
    "Gael", "Gaspar", "Gaston", "Gerardo", "German", "Gilberto", "Giovanni", "Gonzalo", "Gregorio", "Gustavo",
    "Henry", "Heriberto", "Hernan", "Hilario", "Homero", "Horacio", "Humberto", "Isaac", "Isaias", "Isidro",
    "Ismael", "Israel", "Jacinto", "Jacobo", "Jaime", "Jairo", "Jean", "Jeferson", "Jeronimo", "Jesus",
    "Jhon", "Jhonny", "Jhoan", "Jimmy", "Joel", "Johan", "John", "Johnny", "Jonatan", "Jonathan",
    "Josue", "Julian", "Junior", "Justin", "Justo", "Kevin", "Leandro", "Leon", "Leonardo", "Leonel",
    "Leopoldo", "Lorenzo", "Luciano", "Macario", "Marc", "Marcelo", "Marco", "Mariano", "Mauro", "Maximo",
    
    # Expanded Deep Pool (N-Z) & Baseball Vibe
    "Michael", "Moises", "Nestor", "Noel", "Noe", "Norberto", "Octavio", "Oliver", "Omar", "Osvaldo",
    "Paco", "Patricio", "Paul", "Ramiro", "Raymundo", "Rene", "Reynaldo", "Richard", "Rodolfo", "Rodrigo",
    "Rogelio", "Rolando", "Roman", "Romeo", "Romulo", "Roque", "Rufino", "Samuel", "Saul", "Sergio",
    "Simon", "Teodoro", "Thiago", "Valentin", "Vicente", "Walter", "Wilber", "Wilfredo", "William", "Willy",
    "Wilson", "Xavier", "Yadier", "Yamil", "Yoan", "Yordy", "Yuli", "Yulieski", "Zacarias", "Endy",
    "Ezequiel", "Johan", "Neftali", "Odubel", "Rougned", "Starlin", "Ubaldo", "Yonny", "Yovani", "Yuniesky"
]

HISPANIC_LAST = [
    # Your Original Base
    "Garcia", "Martinez", "Rodriguez", "Lopez", "Hernandez", "Gonzalez", "Perez", "Sanchez", "Ramirez", "Torres", 
    "Flores", "Rivera", "Gomez", "Diaz", "Cruz", "Reyes", "Morales", "Ortiz", "Gutierrez", "Chavez", 
    "Ruiz", "Alvarez", "Fernandez", "Jimenez", "Moreno", "Romero", "Herrera", "Medina", "Aguilar", "Vargas",
    "Castillo", "Mendez", "Salazar", "Soto", "Franco", "Dominguez", "Rios", "Silva", "Peña", "Valdez",
    "Mendoza", "Cortez", "Guzman", "Muñoz", "Rojas", "Navarro", "Delgado", "Vega", "Cabrera", "Campos",
    "Acuña", "Tatis", "Guerrero", "Machado", "Altuve", "Bogaerts", "Baez", "Lindor", "Correa", "Devers",
    "Alcantara", "Valdez", "Urias", "Castillo", "Severino", "Marquez", "Peralta", "Gallen", "Lugo", "Suarez",
    "Escobar", "Rosario", "Santana", "Pina", "Gomes", "Molina", "Perez", "Vazquez", "Ramos", "Avila",
    "Quintana", "Carrasco", "Montas", "Berrios", "Cortes", "Urquidy", "Garcia", "Perez", "Luzardo", "Cabrera",
    
    # Expanded Deep Pool (A-F)
    "Acosta", "Aguirre", "Alarcon", "Alba", "Alcala", "Aleman", "Alfaro", "Alicea", "Almanza", "Alonzo",
    "Alvarado", "Amador", "Amaya", "Anaya", "Andrade", "Angulo", "Aquino", "Aragon", "Aranda", "Araujo",
    "Arce", "Arellano", "Arenas", "Arevalo", "Arias", "Armas", "Armenta", "Arriaga", "Arroyo", "Arteaga",
    "Asencio", "Avalos", "Aviles", "Ayala", "Baca", "Balderas", "Banderas", "Banuelos", "Barajas", "Barba",
    "Baret", "Barrera", "Barreto", "Barrios", "Batista", "Bautista", "Becerra", "Beltran", "Benitez", "Bernal",
    "Betancourt", "Blanco", "Blandon", "Bonilla", "Borja", "Bravo", "Brito", "Bueno", "Burgos", "Bustamante",
    "Bustos", "Caballero", "Cadena", "Calderon", "Camacho", "Camargo", "Campa", "Canales", "Candelario", "Cano",
    "Cantu", "Caraballo", "Carbajal", "Cardenas", "Cardona", "Carmona", "Carranza", "Carrillo", "Carrion", "Casanova",
    "Casares", "Casas", "Castañeda", "Castellanos", "Castro", "Cavazos", "Cazares", "Ceballos", "Cedillo", "Ceja",
    "Centeno", "Cepeda", "Cerda", "Cervantes", "Chacon", "Chapa", "Chavarria", "Cisneros", "Clemente", "Cobos",
    "Collazo", "Colon", "Colunga", "Concepcion", "Contreras", "Cordero", "Cordova", "Cornejo", "Corona", "Coronado",
    "Corral", "Corrales", "Cotto", "Covarrubias", "Crespo", "Cuellar", "Cuevas", "Davila", "De Jesus", "De La Cruz",
    "De La Rosa", "De La Torre", "De Leon", "Del Rio", "Del Valle", "Delgadillo", "Diego", "Duarte", "Dueñas",
    "Duran", "Echeverria", "Elizondo", "Enriquez", "Escalante", "Escamilla", "Escobedo", "Esparza", "Espinal", "Espino",
    "Espinosa", "Espinoza", "Esquivel", "Estrada", "Estrella", "Fajardo", "Farias", "Feliciano", "Ferrer", "Fierro",
    "Figueroa", "Fonseca", "Frias", "Fuentes",
    
    # Expanded Deep Pool (G-Z)
    "Gaitan", "Galarza", "Galindo", "Gallardo", "Gallegos", "Galvan", "Gamez", "Gaona", "Garibay", "Garrido",
    "Garza", "Gaston", "Gaytan", "Gil", "Giron", "Godinez", "Godoy", "Gonzales", "Gracia", "Granados",
    "Guardado", "Guerra", "Guevara", "Guillen", "Heredia", "Hidalgo", "Hinojosa", "Huerta", "Hurtado", "Ibarra",
    "Iglesias", "Irizarry", "Jaimes", "Jaramillo", "Jasso", "Juarez", "Jurado", "Lara", "Laureano", "Leal",
    "Ledesma", "Leiva", "Lemus", "Leon", "Leyva", "Limon", "Linares", "Lira", "Llerena", "Loera",
    "Lomeli", "Longoria", "Loya", "Lozada", "Lozano", "Lucas", "Lucero", "Luis", "Lujan", "Luna",
    "Macias", "Madero", "Madrid", "Madrigal", "Magaña", "Maldonado", "Manco", "Manriquez", "Mansilla", "Mantilla",
    "Manzo", "Mares", "Marin", "Marroquin", "Marte", "Marti", "Martin", "Mata", "Mateo", "Matias",
    "Matos", "Maya", "Mayorga", "Mazariegos", "Medrano", "Mejia", "Melendez", "Melgar", "Mena", "Mendiola",
    "Menendez", "Mercado", "Merida", "Merino", "Mesa", "Meza", "Milan", "Millan", "Mina", "Munguia", "Muro"
]

JAPANESE_FIRST = [
    # Your Original Base
    "Hiroshi", "Minoru", "Makoto", "Kenji", "Takashi", "Akira", "Shigeru", "Yutaka", "Mamoru", "Shohei", 
    "Ichiro", "Hideki", "Kenta", "Masahiro", "Tetsuya", "Kazuo", "Yoshi", "Noboru", "Taro", "Daiki",
    "Yuki", "Ryota", "Koji", "Takuya", "Shin", "Yuta", "Naoto", "Keisuke", "Haruto", "Sota",
    "Riku", "Ren", "Hinata", "Ryu", "Satoshi", "Jun", "Masato", "Hiroki", "Ryo", "Seiji",
    "Kaito", "Taiga", "Asahi", "Kazuki", "Tomoya", "Ryosuke", "Kazuya", "Tatsuya", "Shota", "Yuto", 
    "Kosei", "Daigo", "Goro", "Kei", "Takeru", "Yamato", "Itsuki", "Haruma", "Kosuke", "Tsubasa",
    "Seiya", "Yu", "Masataka", "Yoshinobu", "Roki", "Kodai", "Shingo", "Munetaka", "Kensuke", "Hiromi",
    "Tomoyuki", "Tetsuto", "Hayato", "Sosuke", "Shugo", "Takumi", "Kaima", "Taisei",
    
    # Modern & Popular Additions
    "Minato", "Aoi", "Touma", "Itsuki", "Sora", "Rui", "Yuma", "Reo", "Jin", "Arata",
    "Soma", "Ayato", "Eita", "Dan", "Iori", "Kanata", "Matsuki", "Nagi", "Oka", "Rai",
    
    # Traditional / Classic
    "Akio", "Chiyo", "Daichi", "Eiji", "Etsuo", "Fumio", "Gen", "Hideo", "Isamu", "Jiro",
    "Katsuo", "Kiyoshi", "Michio", "Mitsuaki", "Nori", "Osamu", "Raiden", "Saburo", "Shiro", "Tadao",
    "Tatsuo", "Yori", "Yukio", "Zen", "Eikichi", "Heizo", "Ichita", "Kichiro", "Morio", "Rokuro",
    
    # Baseball / Athletic Vibe
    "Tomo", "Sho", "Takanori", "Yoshio", "Tadahito", "Akinori", "Kenshin", "Hideo", "So", "Ukyo",
    "Genshirou", "Kyohei", "Rikuto", "Ryosei", "Toshinori", "Yasuhiro", "Zentaro", "Kyosuke", "Ryuji", "Shinya"
]

JAPANESE_LAST = [
    # Your Original Base
    "Sato", "Suzuki", "Takahashi", "Tanaka", "Watanabe", "Ito", "Yamamoto", "Nakamura", "Kobayashi", "Kato", 
    "Yoshida", "Yamada", "Sasaki", "Yamaguchi", "Matsumoto", "Inoue", "Kimura", "Hayashi", "Shimizu", "Yamazaki",
    "Nakajima", "Ogawa", "Okada", "Hasegawa", "Murakami", "Kondo", "Ishii", "Saito", "Fukuda", "Ota",
    "Fujita", "Morita", "Endo", "Nakano", "Matsuda", "Kojima", "Maeda", "Fujiwara", "Uchida", "Goto",
    "Abe", "Hoshino", "Ishida", "Matsui", "Nakagawa", "Nishimura", "Sugiyama", "Takagi", "Uchiyama", "Wada", 
    "Nomura", "Sakai", "Yokoyama", "Ueda", "Kuroda", "Aoki", "Miyazaki", "Takano", "Okano", "Kikuchi",
    "Ohtani", "Darvish", "Senga", "Imanaga", "Akiyama", "Tsutsugo", "Sawamura", "Iguchi", "Matsuzaka",
    "Nomo", "Iwakuma", "Uehara", "Fukudome", "Iwamura", "Johjima",
    
    # Very Common Additions
    "Hase", "Harada", "Hashimoto", "Hirano", "Hirose", "Honda", "Hori", "Igarashi", "Imai", "Ishibashi",
    "Ishihara", "Iwasaki", "Kaneko", "Kawaguchi", "Kawahara", "Kawakami", "Kawamura", "Kawasaki", "Kinoshita", "Kudo",
    
    # Nature & Geographic Origins
    "Kumagai", "Kurokawa", "Maruyama", "Masuda", "Matsubara", "Matsumura", "Matsushita", "Matsuura", "Minami", "Miura",
    "Miyamoto", "Miyata", "Mochizuki", "Mori", "Morimoto", "Murata", "Nagai", "Nagase", "Nakada", "Nakahara",
    
    # Historic / Rare / Noble Vibe
    "Nakata", "Nakayama", "Narita", "Noda", "Noguchi", "Oba", "Oda", "Ogata", "Ohashi", "Oishi",
    "Okabe", "Okamura", "Okazaki", "Omori", "Ono", "Osada", "Oshima", "Otsuka", "Oyama", "Ryu",
    "Sakamoto", "Sakurai", "Sano", "Sasagawa", "Shibata", "Shimada", "Shinohara", "Shirai", "Sugawara", "Sugimoto",
    
    # Extra Baseball / Regional Variety
    "Taguchi", "Takada", "Takahara", "Takai", "Takeda", "Takei", "Takemoto", "Takeuchi", "Tamura", "Tani",
    "Taniguchi", "Terada", "Tobita", "Toda", "Tokuda", "Tomita", "Toyoda", "Tsuboi", "Tsuchiya", "Tsuda",
    "Tsuji", "Tsukamoto", "Uemura", "Ueno", "Wakabayashi", "Yagi", "Yajima", "Yamagishi", "Yamakawa", "Yamanaka",
    "Yamashita", "Yamauchi", "Yanagi", "Yano", "Yasuda", "Yokota", "Yoshikawa", "Yoshimura", "Yoshino", "Yoshioka"
]

KOREAN_FIRST = [
    # Your Original Base
    "Min-ho", "Ji-hoon", "Hyun-woo", "Seo-joon", "Do-yoon", "Joo-won", "Eun-woo", "Si-woo", "Ha-joon", "Gun-woo", 
    "Dong-hyun", "Sung-min", "Jung-hoon", "Tae-hyung", "Jae-sung", "Seung-ho", "Ki-bum", "Dong-yoon", "Chan-woo", "Joon-ho",
    "Kyung-soo", "Sang-hoon", "Ye-joon", "Woo-jin", "Min-jun", "Ji-ho", "Seo-jin", "Joo-hyuk", "Sung-woo", "Kwang-soo",
    "Min-jae", "Ji-won", "Do-hyun", "Seung-yoon", "Tae-min", "Jung-woo", "Jin-woo", "Sung-ho", "Ki-tae", "Min-soo", 
    "Young-ho", "Jong-in", "Tae-il", "Byung-hun", "Dong-hae", "Myung-soo", "Chang-min", "Ki-young", "Seung-hwan", "In-ho",
    "Ha-seong", "Jung-hoo", "Shin-soo", "Chan-ho", "Ji-man", "Byung-ho", "Kwang-hyun", "Hyun-jin", "Hyo-joo", "Seung-yu",
    "Chang-ho", "Dae-ho", "Dae-sung", "Dong-joo", "Hee-seop", "Jae-gyun", "Jae-weong", "Jung-ho", "Ki-joo", "Sang-woo",
    "Seung-yeop", "Suk-min", "Tae-kyun", "Yong-taik", "Hyun-soo", "Jae-hwan", "Geon-chang", "Eui-ji", "Byung-kyu", "Jong-beom",
    
    # Expanded Deep Pool (Classic & Modern Male Names)
    "Jae-yong", "Dong-wook", "Ji-seok", "Ho-jin", "Jong-soo", "Tae-young", "Kyung-ho", "Sung-jin", "Sang-min", "Ji-tae",
    "Jung-hwan", "Young-jae", "Dong-ha", "Min-hyuk", "Ki-woong", "Hyun-seok", "Jae-won", "Do-jin", "Eun-ho", "Ji-sung",
    "Tae-wan", "Chan-young", "Seung-gi", "Yong-hwa", "Myung-hun", "Kyung-chul", "Hyo-seop", "Dae-jung", "Sun-woo", "Bo-gum",
    "Woo-sung", "Tae-joon", "Min-kyu", "Jin-hyuk", "Sang-wook", "Jong-hyuk", "Dong-gun", "Ji-yong", "Seung-woo", "Kwang-ho",
    "Yong-jun", "Jung-tae", "Chul-soo", "Hyun-bin", "Woo-bin", "Se-hun", "Baek-hyun", "Chan-yeol", "Jong-dae", "Min-seok",
    "Joon-myeon", "In-sung", "Seok-jin", "Nam-joon", "Ho-seok", "Tae-yang", "Seung-hyun", "Ryeo-wook", "Jong-woon", "Kyoo-hyun",
    "Hee-chul", "Jung-su", "Young-woon", "Jae-hyo", "Chang-sub", "Hyun-sik", "Il-hoon", "Sung-jae", "Eun-kwang", "Jin-young",
    
    # Baseball / Athletic Vibe
    "Dong-won", "Sun-dong", "Jong-bum", "Jin-woo", "Sang-ho", "Min-chul", "Hae-min", "Ja-wook", "Won-joon", "Baek-ho",
    "Chang-ki", "Jung-dae", "Kwang-min", "Hyun-seung", "Ji-hwan", "Seung-rak", "Jong-kyu", "Sung-bum", "Eun-sung", "Ho-young"
]

KOREAN_LAST = [
    # Your Original Base
    "Kim", "Lee", "Park", "Choi", "Jung", "Kang", "Cho", "Yoon", "Jang", "Lim", 
    "Han", "Shin", "Oh", "Seo", "Kwon", "Hwang", "Ahn", "Song", "Jeon", "Bae",
    "Baek", "Ryu", "Nam", "Go", "Moon", "Yoo", "Noh", "Kwak", "Jeoung", "Chae", 
    "Heo", "Yang", "Son", "Hong", "Gwon", "Hahm", "Seol", "Pyeon", "Ok", "Min", 
    "Gil", "Goo", "Eom", "Do", "Choo", "Im", "Sim", "Ko", "Ha", "Baek", 
    "Woo", "Yeo", "You", "Paik", "Pang", "Pyun", "Suh", "Suk", "Sun", "Sung",
    
    # Expanded Deep Pool (Rare Surnames & Alternative Romanizations)
    "Ban", "Bang", "Bong", "Bu", "Byun", "Cha", "Cheon", "Chi", "Chin", "Chu",
    "Chun", "Dang", "Eun", "Eung", "Gak", "Gal", "Gam", "Geum", "Gim", "Gong",
    "Gu", "Guk", "Gwak", "Ham", "Ho", "Hyun", "In", "Jhun", "Ji", "Jin",
    "Jo", "Jon", "Joo", "Jun", "Kal", "Kam", "Ki", "Kil", "Koo", "Ku",
    "La", "Ma", "Mae", "Maeng", "Mok", "Myung", "Na", "No", "Pae", "Pan",
    "Pio", "Pyo", "Ra", "Ri", "Rim", "Ro", "Roh", "Ryoo", "Ryuk", "Sa",
    "Seok", "Seon", "Seong", "So", "Soh", "Tae", "U", "Uh", "Um", "Wang",
    "Won", "Ye", "Yeon", "Yi", "Yong", "Yu", "Yum", "Yun", "Jeong", "Rhee",
    
    # Two-Syllable Surnames (Very Rare but culturally significant)
    "Namgoong", "Hwangbo", "Jegal", "Sagong", "Seonu", "Dokgo", "Dongbang"
]

# Global set to track exact full names and ensure zero duplicates
generated_full_names = set()

def get_unique_name():
    while True:
        rand_heritage = random.random()
        
        # Determine heritage and name mixing based on requested percentages
        # 50% Western, 20% Hispanic, 20% Japanese, 10% Korean
        
        if rand_heritage < 0.50:
            # 50% Western Heritage
            first = random.choice(WESTERN_FIRST)
            last = random.choice(WESTERN_LAST)
        elif rand_heritage < 0.70:
            # 20% Hispanic Heritage (30% chance of a Western first name)
            first = random.choice(WESTERN_FIRST) if random.random() < 0.3 else random.choice(HISPANIC_FIRST)
            last = random.choice(HISPANIC_LAST)
        elif rand_heritage < 0.90:
            # 20% Japanese Heritage (30% chance of a Western first name)
            first = random.choice(WESTERN_FIRST) if random.random() < 0.3 else random.choice(JAPANESE_FIRST)
            last = random.choice(JAPANESE_LAST)
        else:
            # 10% Korean Heritage (30% chance of a Western first name)
            first = random.choice(WESTERN_FIRST) if random.random() < 0.3 else random.choice(KOREAN_FIRST)
            last = random.choice(KOREAN_LAST)

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
        "draft_class_year": 2026 - years_pro if years_pro > 0 else None, # Base 2026 year adjusted dynamically based on pro tenure
        "draft_round": random.randint(1, 30) if status != 'prospect' else None,
        "years_pro": years_pro,
        "retirement_year": 2026 if status == 'retired' else None
    }

# Execution
target_league_id = str(uuid.uuid4())
# Feel free to change this range to generate 10,000+ players if needed!
players_data = [generate_player(target_league_id) for _ in range(900)]

with open('players_900_updated_pools.json', 'w', encoding='utf-8') as f:
    json.dump(players_data, f, indent=4, ensure_ascii=False)

print(f"✅ Successfully generated {len(players_data)} unique players with the newly updated probability distribution.")