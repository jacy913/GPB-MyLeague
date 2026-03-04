import {
  BATTING_POSITIONS,
  BATTING_ROSTER_SLOTS,
  BULLPEN_ROSTER_SLOTS,
  CORE_ROSTER_SLOTS,
  CoreRosterSlotCode,
  LeaguePlayerState,
  PitcherPosition,
  Player,
  PlayerBattingRatings,
  PlayerPosition,
  PlayerPitchingRatings,
  PlayerSeasonBatting,
  PlayerSeasonPitching,
  PlayerStatus,
  RESERVE_ROSTER_SLOTS,
  RosterSlotCode,
  STARTING_PITCHER_SLOTS,
  Team,
  TeamRosterSlot,
} from '../types';
import { generatePlayerBio } from './playerBio';

type RandomSource = () => number;
type AgeBucket = 'prospect' | 'peak' | 'veteran';
type OverallTierKey =
  | 'generational'
  | 'superstar'
  | 'all_star'
  | 'support'
  | 'utility'
  | 'journeyman'
  | 'replacement';

interface WeightedEntry<T> {
  value: T;
  weight: number;
}

interface OverallTier {
  key: OverallTierKey;
  min: number;
  max: number;
  weight: number;
}

interface PlayerBlueprint {
  status: PlayerStatus;
  ageBucket: AgeBucket;
  primaryPosition: PlayerPosition;
  teamId: string | null;
  slotCode: RosterSlotCode | null;
}

const DEFAULT_RANDOM: RandomSource = () => Math.random();

export const DEFAULT_PLAYER_POOL_SIZE = 1320;
export const DEFAULT_DRAFT_CLASS_SIZE = 100;
export const DEFAULT_PLAYER_REPLENISHMENT_THRESHOLD = 1100;

const DEFAULT_SUPPLEMENTAL_POOL_SIZE = 392;
const DEFAULT_PROSPECT_POOL_SIZE = 200;
const RESERVE_BATTER_SLOTS_PER_TEAM = 6;
const SUPPLEMENTAL_BATTER_COUNT = 262;
const SUPPLEMENTAL_PITCHER_TARGETS: Record<PitcherPosition, number> = {
  SP: 20,
  RP: 97,
  CL: 13,
};

const WESTERN_FIRST = [
  'DeAndre', 'DeShawn', 'Jamal', 'Malik', 'Trevon', 'Tyrese', 'Tyrone', 'Darnell', 'Marquis', 'Terrell',
  'Tremaine', 'DeMarcus', 'Kendrick', 'Tariq', 'Omari', 'Jalen', 'Darius', 'Rashad', 'Deon', 'Kevon',
  'Devonte', 'Trayvon', 'Lamarcus', 'Jaquan', "D'Angelo", 'Keyshawn', 'Daunte', 'Raheem', 'Jabari', 'Kahlil',
  'Khalil', 'Lamar', 'Desmond', 'Demario', 'Deangelo', 'Tyrell', 'Javon', 'Jamar', 'Kareem', 'Antwan',
  'Damarcus', 'Dequan', 'Treyvon', 'Davion', 'Tyriek', 'Donte', 'Trevion', 'Tyshawn', 'Kwame',
  'Ivan', 'Boris', 'Vladimir', 'Igor', 'Nikolai', 'Dimitri', 'Milan', 'Novak', 'Luka', 'Sasha',
  'Milos', 'Goran', 'Stefan', 'Dragan', 'Bogdan', 'Vlad', 'Sergei', 'Anton', 'Yuri', 'Pavel',
  'Roman', 'Mikhail', 'Aleksei', 'Stanislav', 'Maksim', 'Ilija', 'Darko', 'Marko', 'Zoltan', 'Marek',
  'AJ', 'CJ', 'DJ', 'JJ', 'JR', 'JT', 'RJ', 'TJ', 'KC', 'MJ',
  'PJ', 'BJ', 'JC', 'DC', 'TC', 'KD', 'JD', 'JP', 'OJ', 'VJ',
  'Aaron', 'Abraham', 'Adam', 'Adrian', 'Aidan', 'Alan', 'Albert', 'Alec', 'Alex', 'Alexander',
  'Allen', 'Alton', 'Alvin', 'Amos', 'Andre', 'Andrew', 'Andy', 'Anthony', 'Archer', 'Archie',
  'Arthur', 'Asher', 'Ashton', 'August', 'Austin', 'Avery', 'Axel',
  'Bailey', 'Barry', 'Bart', 'Beau', 'Beck', 'Beckett', 'Ben', 'Benjamin', 'Bennett', 'Benson',
  'Bentley', 'Bernard', 'Bill', 'Billy', 'Blaine', 'Blake', 'Bo', 'Bob', 'Bobby', 'Bodhi',
  'Brad', 'Bradley', 'Brady', 'Brandon', 'Brantley', 'Braxton', 'Brayden', 'Brendan', 'Brennan',
  'Brent', 'Brett', 'Brian', 'Brice', 'Brock', 'Brody', 'Bronson', 'Brooks', 'Bruce', 'Bryan',
  'Bryant', 'Bryce', 'Bryson', 'Buck', 'Buddy', 'Burt', 'Buster', 'Byron',
  'Cade', 'Caden', 'Caleb', 'Callum', 'Calvin', 'Camden', 'Cameron', 'Carl', 'Carlos', 'Carson',
  'Carter', 'Case', 'Cash', 'Cason', 'Cassius', 'Cecil', 'Cedric', 'Chad', 'Chance', 'Chandler',
  'Charles', 'Charlie', 'Chase', 'Chester', 'Chris', 'Christian', 'Christopher', 'Chuck',
  'Clarence', 'Clark', 'Clay', 'Clayton', 'Clifford', 'Clifton', 'Clint', 'Clinton', 'Clyde',
  'Cody', 'Cohen', 'Colby', 'Cole', 'Colin', 'Collin', 'Colt', 'Colton', 'Conner', 'Connor',
  'Conrad', 'Cooper', 'Corbin', 'Corey', 'Cory', 'Craig', 'Creed', 'Crew', 'Cruz', 'Cullen', 'Curtis', 'Cyrus',
  'Dakota', 'Dale', 'Dallas', 'Dalton', 'Damian', 'Damien', 'Damon', 'Dan', 'Dane', 'Daniel',
  'Danny', 'Dante', 'Darian', 'Darien', 'Darin', 'Darrell', 'Darnell', 'Darren',
  'Darryl', 'Darwin', 'Dash', 'Dave', 'David', 'Davin', 'Davis', 'Dawson', 'Dax', 'Daxton',
  'Dayton', 'Dean', 'Declan', 'Demetrius', 'Denis', 'Dennis', 'Denver', 'Derek', 'Derrick',
  'Desmond', 'Devin', 'Devon', 'Dexter', 'Diego', 'Dillon', 'Dion', 'Dirk', 'Dixon', 'Dominic',
  'Dominick', 'Don', 'Donald', 'Donovan', 'Dorian', 'Doug', 'Douglas', 'Drake', 'Drew',
  'Duane', 'Duke', 'Duncan', 'Dustin', 'Dusty', 'Dwayne', 'Dwight', 'Dylan',
  'Earl', 'Easton', 'Ed', 'Eddie', 'Edgar', 'Edison', 'Edmund', 'Eduardo', 'Edward', 'Edwin',
  'Eli', 'Elias', 'Elijah', 'Elliot', 'Elliott', 'Ellis', 'Elmer', 'Elton', 'Elvin', 'Elvis',
  'Emanuel', 'Emerson', 'Emery', 'Emil', 'Emiliano', 'Emmanuel', 'Emmett', 'Emmitt', 'Emory',
  'Enoch', 'Enrique', 'Enzo', 'Ephraim', 'Eric', 'Erich', 'Erick', 'Erik', 'Ernest', 'Ernie',
  'Erwin', 'Esteban', 'Ethan', 'Eugene', 'Evan', 'Everett', 'Ezekiel', 'Ezra',
  'Fabian', 'Felipe', 'Felix', 'Fernando', 'Finn', 'Finnegan', 'Finnley', 'Fisher', 'Fletcher',
  'Flint', 'Floyd', 'Flynn', 'Ford', 'Forest', 'Forrest', 'Foster', 'Fox', 'Francesco', 'Francis',
  'Francisco', 'Frank', 'Frankie', 'Franklin', 'Fred', 'Freddie', 'Freddy', 'Frederick', 'Fredrick',
  'Gabe', 'Gabriel', 'Gage', 'Gale', 'Galen', 'Gannon', 'Gareth', 'Garett', 'Garret', 'Garrett',
  'Garrick', 'Garrison', 'Garry', 'Garth', 'Gary', 'Gatlin', 'Gavin', 'Gene', 'Geoffrey', 'George',
  'Gerald', 'Gerard', 'Gerardo', 'Gilbert', 'Gilberto', 'Giles', 'Gino', 'Giovanni', 'Glen',
  'Glenn', 'Gordon', 'Grady', 'Graham', 'Grant', 'Grayson', 'Greg', 'Gregg', 'Gregory', 'Grey',
  'Greyson', 'Griffin', 'Grover', 'Guillermo', 'Gunnar', 'Gunner', 'Gus', 'Guy',
  'Hank', 'Harlan', 'Harley', 'Harold', 'Harper', 'Harrison', 'Harry', 'Harvey', 'Hassan',
  'Hayden', 'Hayes', 'Heath', 'Hector', 'Hendrix', 'Henrik', 'Henry', 'Herbert', 'Herman',
  'Homer', 'Horace', 'Houston', 'Howard', 'Hudson', 'Hugh', 'Hugo', 'Humberto', 'Hunter', 'Huxley',
  'Ian', 'Ibrahim', 'Ignacio', 'Igor', 'Ira', 'Irvin', 'Irving', 'Isaac', 'Isaak', 'Isaiah',
  'Isaias', 'Ishmael', 'Isiah', 'Isidro', 'Ismael', 'Israel', 'Issac', 'Izaiah',
  'Jace', 'Jack', 'Jackie', 'Jackson', 'Jacob', 'Jacoby', 'Jaden', 'Jadon', 'Jagger', 'Jaiden',
  'Jaime', 'Jalen', 'Jamal', 'Jamari', 'James', 'Jameson', 'Jamie', 'Jamison', 'Jared', 'Jase',
  'Jason', 'Jasper', 'Javier', 'Javon', 'Jax', 'Jaxon', 'Jaxson', 'Jay', 'Jayce', 'Jaycob',
  'Jayden', 'Jaylen', 'Jayson', 'Jeb', 'Jed', 'Jedidiah', 'Jefferson', 'Jeffery', 'Jeffrey',
  'Jeremiah', 'Jeremy', 'Jermaine', 'Jerome', 'Jerry', 'Jesse', 'Jessie', 'Jesus', 'Jett',
  'Jim', 'Jimmie', 'Jimmy', 'Joaquin', 'Joe', 'Joel', 'Joey', 'Johan', 'John', 'Johnathan',
  'Johnathon', 'Johnny', 'Jon', 'Jonah', 'Jonas', 'Jonathan', 'Jonathon', 'Jordan', 'Jordon',
  'Jorge', 'Jose', 'Josef', 'Joseph', 'Josh', 'Joshua', 'Josiah', 'Josue', 'Juan', 'Judah',
  'Jude', 'Judson', 'Jules', 'Julian', 'Julien', 'Julio', 'Julius', 'Junior', 'Justice', 'Justin', 'Justus',
  'Kade', 'Kaden', 'Kai', 'Kaiden', 'Kale', 'Kaleb', 'Kameron', 'Kamden', 'Kane', 'Kareem',
  'Karl', 'Karson', 'Karter', 'Kase', 'Kasen', 'Kash', 'Kason', 'Kayden', 'Keanu', 'Keaton',
  'Keegan', 'Keenan', 'Keith', 'Kellan', 'Kellen', 'Kelvin', 'Kendrick', 'Kenji', 'Kennedy',
  'Kenneth', 'Kenny', 'Kent', 'Kenyon', 'Keon', 'Kevin', 'Kian', 'Kieran', 'Killian', 'King',
  'Kingston', 'Kip', 'Kirby', 'Kirk', 'Kiyan', 'Knox', 'Kobe', 'Koby', 'Kody', 'Kohen', 'Kole',
  'Kolton', 'Korbin', 'Kory', 'Kraig', 'Kris', 'Kristian', 'Kristopher', 'Kruz', 'Kurt', 'Kurtis',
  'Kye', 'Kylan', 'Kyle', 'Kyler', 'Kyree',
  'Lachlan', 'Lamar', 'Lambert', 'Lance', 'Landen', 'Landon', 'Landry', 'Lane', 'Langston',
  'Larry', 'Lars', 'Laurence', 'Lawrence', 'Lawson', 'Layne', 'Layton', 'Lazaro', 'Leandro',
  'Lee', 'Legend', 'Leif', 'Leigh', 'Leighton', 'Leland', 'Lemuel', 'Lennon', 'Lennox', 'Leo',
  'Leon', 'Leonard', 'Leonardo', 'Leonel', 'Leonidas', 'Leopold', 'Leroy', 'Les', 'Lester',
  'Levi', 'Lewis', 'Liam', 'Lincoln', 'Lindell', 'Linden', 'Linus', 'Lionel', 'Lloyd', 'Lochlan',
  'Logan', 'London', 'Lonnie', 'Lorenzo', 'Louie', 'Louis', 'Lowell', 'Luc', 'Luca', 'Lucas',
  'Lucian', 'Luciano', 'Lucius', 'Lucky', 'Luigi', 'Luis', 'Lukas', 'Luke', 'Luther',
  'Lyle', 'Lyman', 'Lyndon', 'Lynn',
  'Mac', 'Macaulay', 'Mack', 'Macon', 'Madden', 'Maddox', 'Maddux', 'Magnus', 'Major', 'Makai',
  'Malachi', 'Malachy', 'Malcolm', 'Malik', 'Malloy', 'Manfred', 'Manny', 'Manuel', 'Marc',
  'Marcel', 'Marcellus', 'Marcelo', 'Marco', 'Marcos', 'Marcus', 'Mario', 'Marion', 'Mark',
  'Markel', 'Markus', 'Marlin', 'Marlon', 'Marques', 'Marquis', 'Marshall', 'Martin', 'Marty',
  'Marvin', 'Mason', 'Massimo', 'Mat', 'Mateo', 'Mathew', 'Mathias', 'Matt', 'Matteo', 'Matthew',
  'Matthias', 'Maurice', 'Mauricio', 'Maverick', 'Max', 'Maxim', 'Maximilian', 'Maximiliano',
  'Maximo', 'Maximus', 'Maxwell', 'Mayer', 'Maynard', 'Mccoy', 'Mekhi', 'Mel', 'Melvin', 'Memphis',
  'Mercer', 'Merle', 'Merlin', 'Merrill', 'Merritt', 'Meyer', 'Micah', 'Michael', 'Micheal',
  'Michel', 'Mickey', 'Miguel', 'Mike', 'Mikel', 'Miles', 'Milford', 'Miller', 'Milo',
  'Milton', 'Misael', 'Mitch', 'Mitchell', 'Monroe', 'Monte', 'Montgomery', 'Monty', 'Moore',
  'Morgan', 'Morris', 'Mortimer', 'Morton', 'Moses', 'Murphy', 'Murray', 'Myles', 'Myron',
  'Nash', 'Nasir', 'Nate', 'Nathan', 'Nathanael', 'Nathaniel', 'Neal', 'Ned', 'Nehemiah', 'Neil',
  'Nelson', 'Nestor', 'Nevan', 'Nevin', 'Newton', 'Nicholas', 'Nick', 'Nickolas', 'Nico',
  'Nicolas', 'Nigel', 'Nikko', 'Niko', 'Nikolai', 'Nikolas', 'Niles', 'Nils', 'Nixon', 'Noah',
  'Noble', 'Noel', 'Nolan', 'Norberto', 'Norman', 'Norm', 'Norris', 'North', 'Norton', 'Norwood', 'Nova',
  'Oakley', 'Oakes', 'Obadiah', 'Ocean', 'Octavio', 'Odell', 'Odin', 'Ogden', 'Oliver', 'Ollie',
  'Omar', 'Omari', 'Orion', 'Orlando', 'Orson', 'Orval', 'Orville', 'Osbaldo', 'Osborn', 'Osborne',
  'Oscar', 'Osvaldo', 'Oswaldo', 'Otis', 'Otto', 'Owen', 'Ozzie', 'Ozzy',
  'Pablo', 'Pace', 'Paco', 'Paddy', 'Padraig', 'Palmer', 'Parker', 'Pascal', 'Patrick', 'Paul',
  'Paulie', 'Paxton', 'Payton', 'Pearce', 'Pedro', 'Penn', 'Percy', 'Perry', 'Pete', 'Peter',
  'Peyton', 'Phil', 'Philip', 'Phillip', 'Phineas', 'Phoenix', 'Pierce', 'Pierre', 'Piers',
  'Porter', 'Prentiss', 'Prescott', 'Preston', 'Price', 'Prince', 'Princeton',
  'Quadir', 'Quinton', 'Quintin', 'Quinn', 'Quincy', 'Quigley', 'Quentin', 'Quenten',
  'Ralph', 'Ramsey', 'Randal', 'Randall', 'Randell', 'Randolph', 'Randy', 'Raphael', 'Rashad',
  'Raul', 'Ray', 'Rayan', 'Rayburn', 'Raymon', 'Raymond', 'Raymundo', 'Reagan', 'Reece', 'Reed',
  'Reese', 'Reggie', 'Reginald', 'Reid', 'Reinaldo', 'Remi', 'Remington', 'Remy', 'Rene', 'Reno',
  'Reuben', 'Rex', 'Rey', 'Reynaldo', 'Rhett', 'Rhys', 'Ricardo', 'Richard', 'Richie', 'Richmond',
  'Rick', 'Rickey', 'Rickie', 'Ricky', 'Rico', 'Ridge', 'Rigoberto', 'Riley', 'Rio', 'River',
  'Roan', 'Rob', 'Robbie', 'Robby', 'Robert', 'Roberto', 'Robin', 'Rocco', 'Rocky', 'Rod',
  'Roderick', 'Rodney', 'Rodolfo', 'Rodrick', 'Rodrigo', 'Rogelio', 'Roger', 'Rohan', 'Roland',
  'Rolando', 'Roman', 'Romeo', 'Ron', 'Ronald', 'Ronan', 'Ronin', 'Ronnie', 'Ronny', 'Roosevelt',
  'Rory', 'Roscoe', 'Ross', 'Rowan', 'Rowen', 'Roy', 'Royal', 'Royce', 'Ruben', 'Rubin', 'Rudy',
  'Rufus', 'Rupert', 'Russel', 'Russell', 'Rusty', 'Ryan', 'Ryder', 'Ryker', 'Rylan', 'Ryland',
  'Sabastian', 'Sage', 'Saint', 'Sal', 'Salvador', 'Salvatore', 'Sam', 'Samir', 'Samson', 'Samuel',
  'Santiago', 'Santino', 'Santos', 'Saul', 'Sawyer', 'Scott', 'Scottie', 'Scotty', 'Seamus', 'Sean',
  'Sebastian', 'Sebastien', 'Selwyn', 'Semaj', 'Seneca', 'Sergio', 'Seth', 'Seymour',
  'Shamus', 'Shane', 'Shannon', 'Shaun', 'Shaw', 'Shawn', 'Shay', 'Shayne', 'Shea', 'Sheldon',
  'Shelton', 'Shem', 'Shepherd', 'Sherman', 'Shiloh', 'Shon', 'Sidney', 'Silas', 'Simon', 'Sincere',
  'Skylar', 'Skyler', 'Slade', 'Slater', 'Sol', 'Solomon', 'Sonny', 'Soren', 'Spencer', 'Stan',
  'Stanford', 'Stanley', 'Stanton', 'Stefan', 'Stephan', 'Stephen', 'Stephon', 'Sterling', 'Steve',
  'Steven', 'Stevie', 'Stewart', 'Stone', 'Storm', 'Stuart', 'Sullivan', 'Sutton', 'Sven', 'Sylas', 'Sylvester',
  'Tad', 'Taggart', 'Taj', 'Talon', 'Tanner', 'Tariq', 'Tate', 'Tatum', 'Tavian', 'Taylor', 'Teagan',
  'Ted', 'Teddy', 'Teo', 'Terence', 'Terrance', 'Terrell', 'Terrence', 'Terry', 'Thad', 'Thaddeus',
  'Thatcher', 'Theo', 'Theodore', 'Thiago', 'Thom', 'Thomas', 'Thor', 'Thorn', 'Thornton', 'Thurston',
  'Tiago', 'Tiberius', 'Tiger', 'Tillman', 'Tim', 'Timmy', 'Timothy', 'Tito', 'Titus', 'Tobias',
  'Tobin', 'Toby', 'Tod', 'Todd', 'Tomas', 'Tommy', 'Tony', 'Townes', 'Townsend', 'Trace', 'Tracy',
  'Travis', 'Trayvon', 'Tre', 'Trent', 'Trenton', 'Trevion', 'Trevor', 'Trey', 'Treyton', 'Trinidad',
  'Trinity', 'Tripp', 'Tristan', 'Tristen', 'Tristian', 'Tristin', 'Triston', 'Troy', 'True', 'Truman',
  'Tucker', 'Tullio', 'Tully', 'Turner', 'Ty', 'Tyce', 'Tyler', 'Tylor', 'Tyree', 'Tyrell', 'Tyrese',
  'Tyrone', 'Tyshaun', 'Tyson', 'Tyrus',
  'Ulises', 'Ulysses', 'Uriah', 'Uriel', 'Val', 'Valentin', 'Valentine', 'Valentino', 'Van', 'Vance',
  'Vaughn', 'Vern', 'Vernon', 'Vic', 'Vicente', 'Victor', 'Vidas', 'Vince', 'Vincent', 'Vincenzo',
  'Vinson', 'Virgil', 'Vito', 'Von',
  'Wade', 'Walker', 'Wallace', 'Wally', 'Walter', 'Walton', 'Ward', 'Warren', 'Watson', 'Waylon',
  'Wayne', 'Weaver', 'Webb', 'Webster', 'Weldon', 'Wellington', 'Wells', 'Wendell', 'Werner', 'Wes',
  'Wesley', 'Wesson', 'West', 'Westbrook', 'Weston', 'Wheeler', 'Whit', 'Whitaker', 'Wilber',
  'Wilbert', 'Wilbur', 'Wilden', 'Wilder', 'Wiley', 'Wilfred', 'Wilfredo', 'Will', 'Willem',
  'William', 'Williams', 'Willie', 'Willis', 'Wilmer', 'Wilson', 'Wilton', 'Windsor', 'Winston',
  'Winter', 'Wolf', 'Wolfgang', 'Wood', 'Woodrow', 'Woods', 'Woodson', 'Woody', 'Wright', 'Wyatt', 'Wylie',
  'Xander', 'Xavier', 'Xavi', 'Xzavier', 'Zac', 'Zach', 'Zachariah', 'Zachary', 'Zachery', 'Zack',
  'Zackary', 'Zackery', 'Zaid', 'Zaiden', 'Zain', 'Zaire', 'Zak', 'Zander', 'Zane', 'Zavier', 'Zayd',
  'Zayden', 'Zayn', 'Zeb', 'Zebulon', 'Zechariah', 'Zed', 'Zeke', 'Zephaniah', 'Zeppelin', 'Zeus',
  'Ziggy', 'Zion', 'Ziya', 'Zolt', 'Zoltan',
];

const WESTERN_LAST = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Miller', 'Davis', 'Wilson', 'Anderson', 'Thomas',
  'Taylor', 'Moore', 'Jackson', 'Martin', 'White', 'Harris', 'Clark', 'Lewis', 'Robinson', 'Walker',
  'Young', 'Allen', 'King', 'Wright', 'Scott', 'Hill', 'Green', 'Adams', 'Nelson', 'Baker',
  'Hall', 'Campbell', 'Mitchell', 'Carter', 'Roberts', 'Phillips', 'Evans', 'Turner', 'Parker', 'Edwards',
  'Collins', 'Stewart', 'Morris', 'Murphy', 'Cook', 'Rogers', 'Morgan', 'Peterson', 'Cooper', 'Reed',
  'Bailey', 'Bell', 'Gomez', 'Kelly', 'Howard', 'Ward', 'Cox', 'Diaz', 'Richardson', 'Wood',
  'Watson', 'Brooks', 'Bennett', 'Gray', 'James', 'Reyes', 'Cruz', 'Hughes', 'Price', 'Myers',
  'Long', 'Foster', 'Sanders', 'Ross', 'Morales', 'Powell', 'Sullivan', 'Russell', 'Ortiz', 'Jenkins',
  'Gutierrez', 'Perry', 'Butler', 'Barnes', 'Fisher', 'Henderson', 'Coleman', 'Simmons', 'Patterson', 'Jordan',
  'Reynolds', 'Hamilton', 'Graham', 'Kim', 'Gonzales', 'Alexander', 'Ramos', 'Wallace', 'Griffin', 'West',
  'Whitmore', 'Sinclair', 'Gallagher', 'Callahan', 'Montgomery', 'Sterling', 'Prescott', 'Langdon', 'Carmichael', 'Harrington',
  'Faulkner', 'Delaney', 'Mercer', 'Vance', 'Thorne', 'Hawthorne', 'Beaumont', 'Winslow', 'Copeland', 'Lancaster',
  'Calhoun', 'Dempsey', 'Garrison', 'Hastings', 'Strickland', 'MacMillan', 'Holloway', 'Whitaker', 'Bradford', 'Carver',
  'Boudreaux', 'Clement', 'Fontenot', 'Landry', 'Thibodeaux', 'Benton', 'Blackburn', 'Caldwell', 'Donovan', 'Fletcher',
  'Gallant', 'Hammond', 'Ingram', 'Kearney', 'Lombardi', 'Manning', 'Neville', 'Ogden', 'Pruitt', 'Quinn',
  "O'Connor", "O'Brien", "O'Neill", 'Fitzgerald', 'MacDonald', 'MacLeod', 'Murray', 'Doherty', 'Sweeney', 'Brennan',
  'Doyle', 'Farrell', 'Kavanagh', 'Fraser', 'MacKenzie', 'Cameron', 'Douglas', 'Crawford', 'McIntyre', 'Buchanan',
  'MacKinnon', "O'Donnell", "O'Sullivan", "O'Keefe", "O'Riley", "O'Shea", 'McCarthy', 'McGrath', 'McMahon', 'McSweeney',
  'Jensen', 'Nielsen', 'Hansen', 'Pedersen', 'Lund', 'Lindberg', 'Nygaard', 'Larsen', 'Sorensen', 'Rasmussen',
  'Holm', 'Berg', 'Olsen', 'Johansen', 'Knutsen', 'Lind', 'Dahl', 'Strand', 'Bakken', 'Solberg',
  'Gustafsson', 'Karlsson', 'Svensson', 'Nilsson', 'Larsson', 'Eriksson', 'Persson', 'Olsson', 'Jansson', 'Gunnarsson',
  'Ivanov', 'Smirnov', 'Novak', 'Kowalski', 'Wisniewski', 'Kaminski', 'Petrov', 'Sokolov', 'Popov', 'Lebedev',
  'Volkov', 'Morozov', 'Kozlov', 'Sikora', 'Stepien', 'Kravchenko', 'Shevchenko', 'Dvorak', 'Horak', 'Polak',
  'Bogdanov', 'Pavlov', 'Orlov', 'Markov', 'Zaytsev', 'Zielinski', 'Szymanski', 'Wojcik', 'Dabrowski', 'Zimmerman',
];

const HISPANIC_FIRST = [
  'Mateo', 'Santiago', 'Matias', 'Sebastian', 'Benjamin', 'Martin', 'Nicolas', 'Alejandro', 'Lucas', 'Diego',
  'Daniel', 'Joaquin', 'Tomas', 'Gabriel', 'Emiliano', 'Luis', 'Felipe', 'Carlos', 'Juan', 'Miguel',
  'Javier', 'Jose', 'Fernando', 'Jorge', 'Ricardo', 'Eduardo', 'Raul', 'Hector', 'Julio', 'Victor',
  'Andres', 'Manuel', 'Pedro', 'Roberto', 'Alfonso', 'Guillermo', 'Rafael', 'Oscar', 'Pablo', 'Mario',
  'Arturo', 'Hugo', 'Ignacio', 'Cesar', 'Ivan', 'Cristian', 'Marcos', 'Ruben', 'Emanuel', 'Salvador',
  'Ronald', 'Yordan', 'Vladimir', 'Wander', 'Manny', 'Eloy', 'Ozzie', 'Francisco', 'Amed', 'Teoscar',
  'Ketel', 'Starling', 'Gleyber', 'Eugenio', 'Avisail', 'Marcell', 'Nelson', 'Ramon', 'Sandy', 'Framber',
  'Camilo', 'Edwin', 'Aroldis', 'Raisel', 'Gregory', 'Felix', 'Domingo', 'Yasmani', 'Willson', 'Gary',
  'Geraldo', 'Orlando', 'Enrique', 'Mauricio',
  'Abner', 'Adalberto', 'Adonis', 'Adrian', 'Agustin', 'Alberto', 'Aldo', 'Alexis', 'Alfredo', 'Alonso',
  'Alvaro', 'Amado', 'Angel', 'Antonio', 'Ariel', 'Armando', 'Augusto', 'Aurelio', 'Bartolo', 'Basilio',
  'Benito', 'Bernardo', 'Braulio', 'Brayan', 'Bruno', 'Carmelo', 'Christopher', 'Claudio', 'Clemente', 'Damian',
  'Danilo', 'Danny', 'Dario', 'David', 'Dennis', 'Edgar', 'Edison', 'Efrain', 'Elias', 'Eliezer',
  'Eliseo', 'Elmer', 'Emilio', 'Emmanuel', 'Enzo', 'Erick', 'Ernesto', 'Esteban', 'Eusebio', 'Ezequiel',
  'Fabian', 'Facundo', 'Federico', 'Fermin', 'Fidel', 'Flavio', 'Franco', 'Frank', 'Franklin', 'Freddy',
  'Gael', 'Gaspar', 'Gaston', 'Gerardo', 'German', 'Gilberto', 'Giovanni', 'Gonzalo', 'Gregorio', 'Gustavo',
  'Henry', 'Heriberto', 'Hernan', 'Hilario', 'Homero', 'Horacio', 'Humberto', 'Isaac', 'Isaias', 'Isidro',
  'Ismael', 'Israel', 'Jacinto', 'Jacobo', 'Jaime', 'Jairo', 'Jean', 'Jeferson', 'Jeronimo', 'Jesus',
  'Jhon', 'Jhonny', 'Jhoan', 'Jimmy', 'Joel', 'Johan', 'John', 'Johnny', 'Jonatan', 'Jonathan',
  'Josue', 'Julian', 'Junior', 'Justin', 'Justo', 'Kevin', 'Leandro', 'Leon', 'Leonardo', 'Leonel',
  'Leopoldo', 'Lorenzo', 'Luciano', 'Macario', 'Marc', 'Marcelo', 'Marco', 'Mariano', 'Mauro', 'Maximo',
  'Michael', 'Moises', 'Nestor', 'Noel', 'Noe', 'Norberto', 'Octavio', 'Oliver', 'Omar', 'Osvaldo',
  'Paco', 'Patricio', 'Paul', 'Ramiro', 'Raymundo', 'Rene', 'Reynaldo', 'Richard', 'Rodolfo', 'Rodrigo',
  'Rogelio', 'Rolando', 'Roman', 'Romeo', 'Romulo', 'Roque', 'Rufino', 'Samuel', 'Saul', 'Sergio',
  'Simon', 'Teodoro', 'Thiago', 'Valentin', 'Vicente', 'Walter', 'Wilber', 'Wilfredo', 'William', 'Willy',
  'Wilson', 'Xavier', 'Yadier', 'Yamil', 'Yoan', 'Yordy', 'Yuli', 'Yulieski', 'Zacarias', 'Endy',
  'Neftali', 'Odubel', 'Rougned', 'Starlin', 'Ubaldo', 'Yonny', 'Yovani', 'Yuniesky',
];

const HISPANIC_LAST = [
  'Garcia', 'Martinez', 'Rodriguez', 'Lopez', 'Hernandez', 'Gonzalez', 'Perez', 'Sanchez', 'Ramirez', 'Torres',
  'Flores', 'Rivera', 'Gomez', 'Diaz', 'Cruz', 'Reyes', 'Morales', 'Ortiz', 'Gutierrez', 'Chavez',
  'Ruiz', 'Alvarez', 'Fernandez', 'Jimenez', 'Moreno', 'Romero', 'Herrera', 'Medina', 'Aguilar', 'Vargas',
  'Castillo', 'Mendez', 'Salazar', 'Soto', 'Franco', 'Dominguez', 'Rios', 'Silva', 'Pena', 'Valdez',
  'Mendoza', 'Cortez', 'Guzman', 'Munoz', 'Rojas', 'Navarro', 'Delgado', 'Vega', 'Cabrera', 'Campos',
  'Acuna', 'Tatis', 'Guerrero', 'Machado', 'Altuve', 'Bogaerts', 'Baez', 'Lindor', 'Correa', 'Devers',
  'Alcantara', 'Urias', 'Severino', 'Marquez', 'Peralta', 'Gallen', 'Lugo', 'Suarez', 'Escobar', 'Rosario',
  'Santana', 'Pina', 'Gomes', 'Molina', 'Vazquez', 'Ramos', 'Avila', 'Quintana', 'Carrasco', 'Montas',
  'Berrios', 'Cortes', 'Urquidy', 'Luzardo',
  'Acosta', 'Aguirre', 'Alarcon', 'Alba', 'Alcala', 'Aleman', 'Alfaro', 'Alicea', 'Almanza', 'Alonzo',
  'Alvarado', 'Amador', 'Amaya', 'Anaya', 'Andrade', 'Angulo', 'Aquino', 'Aragon', 'Aranda', 'Araujo',
  'Arce', 'Arellano', 'Arenas', 'Arevalo', 'Arias', 'Armas', 'Armenta', 'Arriaga', 'Arroyo', 'Arteaga',
  'Asencio', 'Avalos', 'Aviles', 'Ayala', 'Baca', 'Balderas', 'Banderas', 'Banuelos', 'Barajas', 'Barba',
  'Baret', 'Barrera', 'Barreto', 'Barrios', 'Batista', 'Bautista', 'Becerra', 'Beltran', 'Benitez', 'Bernal',
  'Betancourt', 'Blanco', 'Blandon', 'Bonilla', 'Borja', 'Bravo', 'Brito', 'Bueno', 'Burgos', 'Bustamante',
  'Bustos', 'Caballero', 'Cadena', 'Calderon', 'Camacho', 'Camargo', 'Campa', 'Canales', 'Candelario', 'Cano',
  'Cantu', 'Caraballo', 'Carbajal', 'Cardenas', 'Cardona', 'Carmona', 'Carranza', 'Carrillo', 'Carrion', 'Casanova',
  'Casares', 'Casas', 'Castaneda', 'Castellanos', 'Castro', 'Cavazos', 'Cazares', 'Ceballos', 'Cedillo', 'Ceja',
  'Centeno', 'Cepeda', 'Cerda', 'Cervantes', 'Chacon', 'Chapa', 'Chavarria', 'Cisneros', 'Clemente', 'Cobos',
  'Collazo', 'Colon', 'Colunga', 'Concepcion', 'Contreras', 'Cordero', 'Cordova', 'Cornejo', 'Corona', 'Coronado',
  'Corral', 'Corrales', 'Cotto', 'Covarrubias', 'Crespo', 'Cuellar', 'Cuevas', 'Davila', 'De Jesus', 'De La Cruz',
  'De La Rosa', 'De La Torre', 'De Leon', 'Del Rio', 'Del Valle', 'Delgadillo', 'Diego', 'Duarte', 'Duenas',
  'Duran', 'Echeverria', 'Elizondo', 'Enriquez', 'Escalante', 'Escamilla', 'Escobedo', 'Esparza', 'Espinal', 'Espino',
  'Espinosa', 'Espinoza', 'Esquivel', 'Estrada', 'Estrella', 'Fajardo', 'Farias', 'Feliciano', 'Ferrer', 'Fierro',
  'Figueroa', 'Fonseca', 'Frias', 'Fuentes',
  'Gaitan', 'Galarza', 'Galindo', 'Gallardo', 'Gallegos', 'Galvan', 'Gamez', 'Gaona', 'Garibay', 'Garrido',
  'Garza', 'Gaston', 'Gaytan', 'Gil', 'Giron', 'Godinez', 'Godoy', 'Gonzales', 'Gracia', 'Granados',
  'Guardado', 'Guerra', 'Guevara', 'Guillen', 'Heredia', 'Hidalgo', 'Hinojosa', 'Huerta', 'Hurtado', 'Ibarra',
  'Iglesias', 'Irizarry', 'Jaimes', 'Jaramillo', 'Jasso', 'Juarez', 'Jurado', 'Lara', 'Laureano', 'Leal',
  'Ledesma', 'Leiva', 'Lemus', 'Leon', 'Leyva', 'Limon', 'Linares', 'Lira', 'Llerena', 'Loera',
  'Lomeli', 'Longoria', 'Loya', 'Lozada', 'Lozano', 'Lucas', 'Lucero', 'Luis', 'Lujan', 'Luna',
  'Macias', 'Madero', 'Madrid', 'Madrigal', 'Magana', 'Maldonado', 'Manco', 'Manriquez', 'Mansilla', 'Mantilla',
  'Manzo', 'Mares', 'Marin', 'Marroquin', 'Marte', 'Marti', 'Martin', 'Mata', 'Mateo', 'Matias',
  'Matos', 'Maya', 'Mayorga', 'Mazariegos', 'Medrano', 'Mejia', 'Melendez', 'Melgar', 'Mena', 'Mendiola',
  'Menendez', 'Mercado', 'Merida', 'Merino', 'Mesa', 'Meza', 'Milan', 'Millan', 'Mina', 'Munguia', 'Muro',
];

const DUTCH_LAST = [
  'De Jong', 'Jansen', 'De Vries', 'Van den Berg', 'Van Dijk', 'Bakker', 'Visser', 'Smit', 'Meijer', 'De Boer',
  'Van der Meer', 'Bos', 'Vos', 'Peters', 'Hendriks', 'Van Leeuwen', 'Dekker', 'Brouwer', 'De Groot', 'Gerritsen',
  'Mulder', 'Kuipers', 'Veenstra', 'Jonker', 'Van Doorn', 'Prins', 'Kramer', 'Scholten', 'Post', 'Vink',
  'Timmermans', 'Groen', 'Koster', 'Willems', 'Evers', 'Hoekstra', 'Maas', 'Ruiter', 'Schutte', 'Vermeulen',
];

const JAPANESE_FIRST = [
  'Hiroshi', 'Minoru', 'Makoto', 'Kenji', 'Takashi', 'Akira', 'Shigeru', 'Yutaka', 'Mamoru', 'Shohei',
  'Ichiro', 'Hideki', 'Kenta', 'Masahiro', 'Tetsuya', 'Kazuo', 'Yoshi', 'Noboru', 'Taro', 'Daiki',
  'Yuki', 'Ryota', 'Koji', 'Takuya', 'Shin', 'Yuta', 'Naoto', 'Keisuke', 'Haruto', 'Sota',
  'Riku', 'Ren', 'Hinata', 'Ryu', 'Satoshi', 'Jun', 'Masato', 'Hiroki', 'Ryo', 'Seiji',
  'Kaito', 'Taiga', 'Asahi', 'Kazuki', 'Tomoya', 'Ryosuke', 'Kazuya', 'Tatsuya', 'Shota', 'Yuto',
  'Kosei', 'Daigo', 'Goro', 'Kei', 'Takeru', 'Yamato', 'Itsuki', 'Haruma', 'Kosuke', 'Tsubasa',
  'Seiya', 'Yu', 'Masataka', 'Yoshinobu', 'Roki', 'Kodai', 'Shingo', 'Munetaka', 'Kensuke', 'Hiromi',
  'Tomoyuki', 'Tetsuto', 'Hayato', 'Sosuke', 'Shugo', 'Takumi', 'Kaima', 'Taisei',
  'Minato', 'Aoi', 'Touma', 'Sora', 'Rui', 'Yuma', 'Reo', 'Jin', 'Arata',
  'Soma', 'Ayato', 'Eita', 'Dan', 'Iori', 'Kanata', 'Matsuki', 'Nagi', 'Oka', 'Rai',
  'Akio', 'Chiyo', 'Daichi', 'Eiji', 'Etsuo', 'Fumio', 'Gen', 'Hideo', 'Isamu', 'Jiro',
  'Katsuo', 'Kiyoshi', 'Michio', 'Mitsuaki', 'Nori', 'Osamu', 'Raiden', 'Saburo', 'Shiro', 'Tadao',
  'Tatsuo', 'Yori', 'Yukio', 'Zen', 'Eikichi', 'Heizo', 'Ichita', 'Kichiro', 'Morio', 'Rokuro',
  'Tomo', 'Sho', 'Takanori', 'Yoshio', 'Tadahito', 'Akinori', 'Kenshin', 'So', 'Ukyo',
  'Genshirou', 'Kyohei', 'Rikuto', 'Ryosei', 'Toshinori', 'Yasuhiro', 'Zentaro', 'Kyosuke', 'Ryuji', 'Shinya',
];

const JAPANESE_LAST = [
  'Sato', 'Suzuki', 'Takahashi', 'Tanaka', 'Watanabe', 'Ito', 'Yamamoto', 'Nakamura', 'Kobayashi', 'Kato',
  'Yoshida', 'Yamada', 'Sasaki', 'Yamaguchi', 'Matsumoto', 'Inoue', 'Kimura', 'Hayashi', 'Shimizu', 'Yamazaki',
  'Nakajima', 'Ogawa', 'Okada', 'Hasegawa', 'Murakami', 'Kondo', 'Ishii', 'Saito', 'Fukuda', 'Ota',
  'Fujita', 'Morita', 'Endo', 'Nakano', 'Matsuda', 'Kojima', 'Maeda', 'Fujiwara', 'Uchida', 'Goto',
  'Abe', 'Hoshino', 'Ishida', 'Matsui', 'Nakagawa', 'Nishimura', 'Sugiyama', 'Takagi', 'Uchiyama', 'Wada',
  'Nomura', 'Sakai', 'Yokoyama', 'Ueda', 'Kuroda', 'Aoki', 'Miyazaki', 'Takano', 'Okano', 'Kikuchi',
  'Ohtani', 'Darvish', 'Senga', 'Imanaga', 'Akiyama', 'Tsutsugo', 'Sawamura', 'Iguchi', 'Matsuzaka', 'Nomo',
  'Iwakuma', 'Uehara', 'Fukudome', 'Iwamura', 'Johjima',
  'Hase', 'Harada', 'Hashimoto', 'Hirano', 'Hirose', 'Honda', 'Hori', 'Igarashi', 'Imai', 'Ishibashi',
  'Ishihara', 'Iwasaki', 'Kaneko', 'Kawaguchi', 'Kawahara', 'Kawakami', 'Kawamura', 'Kawasaki', 'Kinoshita', 'Kudo',
  'Kumagai', 'Kurokawa', 'Maruyama', 'Masuda', 'Matsubara', 'Matsumura', 'Matsushita', 'Matsuura', 'Minami', 'Miura',
  'Miyamoto', 'Miyata', 'Mochizuki', 'Mori', 'Morimoto', 'Murata', 'Nagai', 'Nagase', 'Nakada', 'Nakahara',
  'Nakata', 'Nakayama', 'Narita', 'Noda', 'Noguchi', 'Oba', 'Oda', 'Ogata', 'Ohashi', 'Oishi',
  'Okabe', 'Okamura', 'Okazaki', 'Omori', 'Ono', 'Osada', 'Oshima', 'Otsuka', 'Oyama', 'Ryu',
  'Sakamoto', 'Sakurai', 'Sano', 'Sasagawa', 'Shibata', 'Shimada', 'Shinohara', 'Shirai', 'Sugawara', 'Sugimoto',
  'Taguchi', 'Takada', 'Takahara', 'Takai', 'Takeda', 'Takei', 'Takemoto', 'Takeuchi', 'Tamura', 'Tani',
  'Taniguchi', 'Terada', 'Tobita', 'Toda', 'Tokuda', 'Tomita', 'Toyoda', 'Tsuboi', 'Tsuchiya', 'Tsuda',
  'Tsuji', 'Tsukamoto', 'Uemura', 'Ueno', 'Wakabayashi', 'Yagi', 'Yajima', 'Yamagishi', 'Yamakawa', 'Yamanaka',
  'Yamashita', 'Yamauchi', 'Yanagi', 'Yano', 'Yasuda', 'Yokota', 'Yoshikawa', 'Yoshimura', 'Yoshino', 'Yoshioka',
];

const KOREAN_FIRST = [
  'Min-ho', 'Ji-hoon', 'Hyun-woo', 'Seo-joon', 'Do-yoon', 'Joo-won', 'Eun-woo', 'Si-woo', 'Ha-joon', 'Gun-woo',
  'Dong-hyun', 'Sung-min', 'Jung-hoon', 'Tae-hyung', 'Jae-sung', 'Seung-ho', 'Ki-bum', 'Dong-yoon', 'Chan-woo', 'Joon-ho',
  'Kyung-soo', 'Sang-hoon', 'Ye-joon', 'Woo-jin', 'Min-jun', 'Ji-ho', 'Seo-jin', 'Joo-hyuk', 'Sung-woo', 'Kwang-soo',
  'Min-jae', 'Ji-won', 'Do-hyun', 'Seung-yoon', 'Tae-min', 'Jung-woo', 'Jin-woo', 'Sung-ho', 'Ki-tae', 'Min-soo',
  'Young-ho', 'Jong-in', 'Tae-il', 'Byung-hun', 'Dong-hae', 'Myung-soo', 'Chang-min', 'Ki-young', 'Seung-hwan', 'In-ho',
  'Ha-seong', 'Jung-hoo', 'Shin-soo', 'Chan-ho', 'Ji-man', 'Byung-ho', 'Kwang-hyun', 'Hyun-jin', 'Hyo-joo', 'Seung-yu',
  'Chang-ho', 'Dae-ho', 'Dae-sung', 'Dong-joo', 'Hee-seop', 'Jae-gyun', 'Jae-weong', 'Jung-ho', 'Ki-joo', 'Sang-woo',
  'Seung-yeop', 'Suk-min', 'Tae-kyun', 'Yong-taik', 'Hyun-soo', 'Jae-hwan', 'Geon-chang', 'Eui-ji', 'Byung-kyu', 'Jong-beom',
  'Jae-yong', 'Dong-wook', 'Ji-seok', 'Ho-jin', 'Jong-soo', 'Tae-young', 'Kyung-ho', 'Sung-jin', 'Sang-min', 'Ji-tae',
  'Jung-hwan', 'Young-jae', 'Dong-ha', 'Min-hyuk', 'Ki-woong', 'Hyun-seok', 'Jae-won', 'Do-jin', 'Eun-ho', 'Ji-sung',
  'Tae-wan', 'Chan-young', 'Seung-gi', 'Yong-hwa', 'Myung-hun', 'Kyung-chul', 'Hyo-seop', 'Dae-jung', 'Sun-woo', 'Bo-gum',
  'Woo-sung', 'Tae-joon', 'Min-kyu', 'Jin-hyuk', 'Sang-wook', 'Jong-hyuk', 'Dong-gun', 'Ji-yong', 'Seung-woo', 'Kwang-ho',
  'Yong-jun', 'Jung-tae', 'Chul-soo', 'Hyun-bin', 'Woo-bin', 'Se-hun', 'Baek-hyun', 'Chan-yeol', 'Jong-dae', 'Min-seok',
  'Joon-myeon', 'In-sung', 'Seok-jin', 'Nam-joon', 'Ho-seok', 'Tae-yang', 'Seung-hyun', 'Ryeo-wook', 'Jong-woon', 'Kyoo-hyun',
  'Hee-chul', 'Jung-su', 'Young-woon', 'Jae-hyo', 'Chang-sub', 'Hyun-sik', 'Il-hoon', 'Sung-jae', 'Eun-kwang', 'Jin-young',
  'Dong-won', 'Sun-dong', 'Jong-bum', 'Sang-ho', 'Min-chul', 'Hae-min', 'Ja-wook', 'Won-joon', 'Baek-ho',
  'Chang-ki', 'Jung-dae', 'Kwang-min', 'Hyun-seung', 'Ji-hwan', 'Seung-rak', 'Jong-kyu', 'Sung-bum', 'Eun-sung', 'Ho-young',
];

const KOREAN_LAST = [
  'Kim', 'Lee', 'Park', 'Choi', 'Jung', 'Kang', 'Cho', 'Yoon', 'Jang', 'Lim',
  'Han', 'Shin', 'Oh', 'Seo', 'Kwon', 'Hwang', 'Ahn', 'Song', 'Jeon', 'Bae',
  'Baek', 'Ryu', 'Nam', 'Go', 'Moon', 'Yoo', 'Noh', 'Kwak', 'Jeoung', 'Chae',
  'Heo', 'Yang', 'Son', 'Hong', 'Gwon', 'Hahm', 'Seol', 'Pyeon', 'Ok', 'Min',
  'Gil', 'Goo', 'Eom', 'Do', 'Choo', 'Im', 'Sim', 'Ko', 'Ha', 'Woo',
  'Yeo', 'You', 'Paik', 'Pang', 'Pyun', 'Suh', 'Suk', 'Sun', 'Sung',
  'Ban', 'Bang', 'Bong', 'Bu', 'Byun', 'Cha', 'Cheon', 'Chi', 'Chin', 'Chu',
  'Chun', 'Dang', 'Eun', 'Eung', 'Gak', 'Gal', 'Gam', 'Geum', 'Gim', 'Gong',
  'Gu', 'Guk', 'Gwak', 'Ham', 'Ho', 'Hyun', 'In', 'Jhun', 'Ji', 'Jin',
  'Jo', 'Jon', 'Joo', 'Jun', 'Kal', 'Kam', 'Ki', 'Kil', 'Koo', 'Ku',
  'La', 'Ma', 'Mae', 'Maeng', 'Mok', 'Myung', 'Na', 'No', 'Pae', 'Pan',
  'Pio', 'Pyo', 'Ra', 'Ri', 'Rim', 'Ro', 'Roh', 'Ryoo', 'Ryuk', 'Sa',
  'Seok', 'Seon', 'Seong', 'So', 'Soh', 'Tae', 'U', 'Uh', 'Um', 'Wang',
  'Won', 'Ye', 'Yeon', 'Yi', 'Yong', 'Yu', 'Yum', 'Yun', 'Jeong', 'Rhee',
  'Namgoong', 'Hwangbo', 'Jegal', 'Sagong', 'Seonu', 'Dokgo', 'Dongbang',
];

const CHINESE_LAST = [
  'Wang', 'Li', 'Zhang', 'Liu', 'Chen', 'Yang', 'Huang', 'Zhao', 'Wu', 'Zhou',
  'Xu', 'Sun', 'Ma', 'Zhu', 'Hu', 'Lin', 'Guo', 'He', 'Gao', 'Liang',
  'Zheng', 'Luo', 'Song', 'Xie', 'Tang',
];

const HERITAGE_POOLS = [
  { weight: 50, firstNames: WESTERN_FIRST, lastNames: WESTERN_LAST, westernFirstMixChance: 0 },
  { weight: 20, firstNames: HISPANIC_FIRST, lastNames: HISPANIC_LAST, westernFirstMixChance: 0.3 },
  { weight: 20, firstNames: JAPANESE_FIRST, lastNames: JAPANESE_LAST, westernFirstMixChance: 0.3 },
  { weight: 10, firstNames: KOREAN_FIRST, lastNames: KOREAN_LAST, westernFirstMixChance: 0.3 },
  { weight: 5, firstNames: WESTERN_FIRST, lastNames: DUTCH_LAST, westernFirstMixChance: 0 },
  { weight: 5, firstNames: WESTERN_FIRST, lastNames: CHINESE_LAST, westernFirstMixChance: 0 },
] as const;

const FREE_AGENT_AGE_BUCKETS: Record<Exclude<AgeBucket, 'prospect'>, number> = {
  peak: 144,
  veteran: 48,
};

const SECONDARY_POSITION_MAP: Record<PlayerPosition, PlayerPosition[]> = {
  C: ['1B', 'DH'],
  '1B': ['DH', 'LF'],
  '2B': ['SS', '3B'],
  '3B': ['SS', '1B'],
  SS: ['2B', '3B'],
  LF: ['RF', 'CF', 'DH'],
  CF: ['LF', 'RF'],
  RF: ['LF', 'CF', 'DH'],
  DH: ['1B', 'LF', 'RF'],
  SP: ['RP'],
  RP: ['CL', 'SP'],
  CL: ['RP'],
};

const SLOT_TO_PRIMARY_POSITION: Record<CoreRosterSlotCode, PlayerPosition> = {
  C: 'C',
  '1B': '1B',
  '2B': '2B',
  '3B': '3B',
  SS: 'SS',
  LF: 'LF',
  CF: 'CF',
  RF: 'RF',
  DH: 'DH',
  SP1: 'SP',
  SP2: 'SP',
  SP3: 'SP',
  SP4: 'SP',
  SP5: 'SP',
  RP1: 'RP',
  RP2: 'RP',
  RP3: 'RP',
  RP4: 'RP',
  CL: 'CL',
};

const RESERVE_PITCHER_POSITION_WEIGHTS: Array<WeightedEntry<PitcherPosition>> = [
  { value: 'SP', weight: 2 },
  { value: 'RP', weight: 3 },
  { value: 'CL', weight: 1 },
];

type BatterRatingsProfile = Omit<PlayerBattingRatings, 'playerId' | 'seasonYear'>;
type PitcherRatingsProfile = Omit<PlayerPitchingRatings, 'playerId' | 'seasonYear'>;

const createUuid = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `plr-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
};

const randomInt = (min: number, max: number, rng: RandomSource): number =>
  Math.floor(rng() * (max - min + 1)) + min;

const clampRating = (value: number): number => Math.max(60, Math.min(100, Math.round(value)));

const ACTIVE_OVERALL_TIERS: OverallTier[] = [
  { key: 'generational', min: 95, max: 100, weight: 1 },
  { key: 'superstar', min: 90, max: 94, weight: 12 },
  { key: 'all_star', min: 85, max: 89, weight: 18 },
  { key: 'support', min: 80, max: 84, weight: 22 },
  { key: 'utility', min: 75, max: 79, weight: 18 },
  { key: 'journeyman', min: 70, max: 74, weight: 14 },
  { key: 'replacement', min: 60, max: 69, weight: 15 },
];

type OverallTierKey = OverallTier['key'];
type PoolStatus = Exclude<PlayerStatus, 'retired'>;

type TierQuotaAllocation = {
  key: OverallTierKey;
  min: number;
  max: number;
  counts: Record<PoolStatus, number>;
};

const PLAYER_POOL_TIER_QUOTAS: TierQuotaAllocation[] = [
  { key: 'generational', min: 95, max: 100, counts: { active: 10, free_agent: 0, prospect: 0 } },
  { key: 'superstar', min: 90, max: 94, counts: { active: 31, free_agent: 0, prospect: 4 } },
  { key: 'all_star', min: 85, max: 89, counts: { active: 115, free_agent: 10, prospect: 20 } },
  { key: 'support', min: 80, max: 84, counts: { active: 200, free_agent: 25, prospect: 55 } },
  { key: 'utility', min: 75, max: 79, counts: { active: 170, free_agent: 40, prospect: 75 } },
  { key: 'journeyman', min: 70, max: 74, counts: { active: 60, free_agent: 54, prospect: 36 } },
  { key: 'replacement', min: 60, max: 69, counts: { active: 22, free_agent: 63, prospect: 10 } },
];

const FREE_AGENT_OVERALL_TIERS: OverallTier[] = [
  { key: 'all_star', min: 85, max: 89, weight: 2 },
  { key: 'support', min: 80, max: 84, weight: 10 },
  { key: 'utility', min: 75, max: 79, weight: 24 },
  { key: 'journeyman', min: 70, max: 74, weight: 28 },
  { key: 'replacement', min: 60, max: 69, weight: 36 },
];

const PROSPECT_OVERALL_TIERS: OverallTier[] = [
  { key: 'superstar', min: 90, max: 94, weight: 1 },
  { key: 'all_star', min: 85, max: 89, weight: 6 },
  { key: 'support', min: 80, max: 84, weight: 18 },
  { key: 'utility', min: 75, max: 79, weight: 32 },
  { key: 'journeyman', min: 70, max: 74, weight: 28 },
  { key: 'replacement', min: 60, max: 69, weight: 15 },
];

const weightedChoice = <T,>(entries: Array<WeightedEntry<T>>, rng: RandomSource): T => {
  const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0);
  let cursor = rng() * totalWeight;

  for (const entry of entries) {
    cursor -= entry.weight;
    if (cursor <= 0) {
      return entry.value;
    }
  }

  return entries[entries.length - 1].value;
};

const sample = <T,>(items: T[], rng: RandomSource): T => items[Math.floor(rng() * items.length)];

const shuffle = <T,>(items: T[], rng: RandomSource): T[] => {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
};

const distributeEvenly = <T extends string>(values: T[], total: number): Record<T, number> => {
  const base = Math.floor(total / values.length);
  let remainder = total % values.length;

  return values.reduce((result, value) => {
    result[value] = base + (remainder > 0 ? 1 : 0);
    remainder -= 1;
    return result;
  }, {} as Record<T, number>);
};

const buildBucketPool = <T extends string>(counts: Record<T, number>): T[] =>
  Object.entries(counts).flatMap(([key, count]) => Array.from({ length: count }, () => key as T));

const getActiveAgeBuckets = (activePlayerCount: number): Array<Exclude<AgeBucket, 'prospect'>> => {
  const veteranCount = Math.round(activePlayerCount * 0.25);
  const peakCount = Math.max(activePlayerCount - veteranCount, 0);

  return [
    ...Array.from({ length: peakCount }, () => 'peak' as const),
    ...Array.from({ length: veteranCount }, () => 'veteran' as const),
  ];
};

const getAgeForBucket = (bucket: AgeBucket, rng: RandomSource): number => {
  if (bucket === 'prospect') {
    return randomInt(18, 22, rng);
  }
  if (bucket === 'peak') {
    return randomInt(23, 32, rng);
  }
  return randomInt(33, 39, rng);
};

const getPotential = (status: PlayerStatus, bucket: AgeBucket, rng: RandomSource): number => {
  if (status === 'prospect') {
    return Number((0.62 + rng() * 0.35).toFixed(3));
  }
  if (bucket === 'peak') {
    return Number((0.42 + rng() * 0.46).toFixed(3));
  }
  return Number((0.22 + rng() * 0.38).toFixed(3));
};

const pickOverallTier = (player: Player, rng: RandomSource): OverallTier => {
  const tiers =
    player.status === 'active'
      ? ACTIVE_OVERALL_TIERS
      : player.status === 'prospect'
        ? PROSPECT_OVERALL_TIERS
        : FREE_AGENT_OVERALL_TIERS;

  return weightedChoice(
    tiers.map((tier) => ({
      value: tier,
      weight: tier.weight,
    })),
    rng,
  );
};

const getCurrentOverallBaseline = (player: Player, rng: RandomSource): number => {
  const tier = pickOverallTier(player, rng);
  const base = randomInt(tier.min, tier.max, rng);
  const ageCurve =
    player.age <= 21 ? -2
      : player.age <= 24 ? 0
        : player.age <= 29 ? 2
          : player.age <= 32 ? 1
            : player.age <= 35 ? -1
              : -3;
  const potentialLift = Math.round((player.potential - 0.5) * 8);
  return clampRating(base + ageCurve + potentialLift);
};

const getPotentialOverall = (player: Player, currentOverall: number, rng: RandomSource): number => {
  const growthWindow =
    player.age <= 20 ? randomInt(8, 16, rng)
      : player.age <= 24 ? randomInt(5, 11, rng)
        : player.age <= 28 ? randomInt(2, 7, rng)
          : player.age <= 32 ? randomInt(0, 4, rng)
            : randomInt(-3, 2, rng);
  const potentialBias = Math.round((player.potential - 0.5) * 10);
  return clampRating(currentOverall + growthWindow + potentialBias);
};

const varyAttribute = (base: number, spread: number, rng: RandomSource): number =>
  clampRating(base + randomInt(-spread, spread, rng));

const sampleTierOverall = (min: number, max: number, rng: RandomSource): number => {
  const triangular = (rng() + rng() + rng()) / 3;
  return clampRating(min + triangular * (max - min));
};

const alignBatterProfileOverall = (
  profile: Omit<BatterRatingsProfile, 'overall' | 'potentialOverall'>,
  targetOverall: number,
): Omit<BatterRatingsProfile, 'overall' | 'potentialOverall'> => {
  const adjusted = { ...profile };
  for (let index = 0; index < 8; index += 1) {
    const current = getBatterOverall(adjusted);
    const delta = targetOverall - current;
    if (Math.abs(delta) <= 1) {
      break;
    }
    const step = Math.sign(delta) * Math.max(1, Math.ceil(Math.abs(delta) / 2));
    adjusted.contact = clampRating(adjusted.contact + step);
    adjusted.power = clampRating(adjusted.power + step);
    adjusted.plateDiscipline = clampRating(adjusted.plateDiscipline + step);
    adjusted.avoidStrikeout = clampRating(adjusted.avoidStrikeout + step);
    adjusted.speed = clampRating(adjusted.speed + Math.sign(delta));
    adjusted.baserunning = clampRating(adjusted.baserunning + Math.sign(delta));
    adjusted.fielding = clampRating(adjusted.fielding + Math.sign(delta));
    adjusted.arm = clampRating(adjusted.arm + Math.sign(delta));
  }
  return adjusted;
};

const alignPitcherProfileOverall = (
  profile: Omit<PitcherRatingsProfile, 'overall' | 'potentialOverall'>,
  targetOverall: number,
): Omit<PitcherRatingsProfile, 'overall' | 'potentialOverall'> => {
  const adjusted = { ...profile };
  for (let index = 0; index < 8; index += 1) {
    const current = getPitcherOverall(adjusted);
    const delta = targetOverall - current;
    if (Math.abs(delta) <= 1) {
      break;
    }
    const step = Math.sign(delta) * Math.max(1, Math.ceil(Math.abs(delta) / 2));
    adjusted.stuff = clampRating(adjusted.stuff + step);
    adjusted.command = clampRating(adjusted.command + step);
    adjusted.control = clampRating(adjusted.control + step);
    adjusted.movement = clampRating(adjusted.movement + step);
    adjusted.stamina = clampRating(adjusted.stamina + Math.sign(delta));
    adjusted.holdRunners = clampRating(adjusted.holdRunners + Math.sign(delta));
    adjusted.fielding = clampRating(adjusted.fielding + Math.sign(delta));
  }
  return adjusted;
};

const getBatterPositionBias = (position: PlayerPosition) => {
  switch (position) {
    case 'C':
      return { contact: 0, power: -2, plateDiscipline: 1, avoidStrikeout: 0, speed: -10, baserunning: -8, fielding: 8, arm: 9 };
    case '1B':
      return { contact: 2, power: 8, plateDiscipline: 1, avoidStrikeout: -1, speed: -10, baserunning: -7, fielding: -1, arm: -2 };
    case '2B':
      return { contact: 4, power: -2, plateDiscipline: 2, avoidStrikeout: 3, speed: 5, baserunning: 4, fielding: 6, arm: 1 };
    case '3B':
      return { contact: 1, power: 6, plateDiscipline: 0, avoidStrikeout: -1, speed: -2, baserunning: -2, fielding: 3, arm: 8 };
    case 'SS':
      return { contact: 3, power: -1, plateDiscipline: 1, avoidStrikeout: 2, speed: 6, baserunning: 5, fielding: 9, arm: 6 };
    case 'LF':
      return { contact: 1, power: 4, plateDiscipline: 0, avoidStrikeout: -1, speed: 0, baserunning: 0, fielding: -1, arm: 1 };
    case 'CF':
      return { contact: 2, power: -2, plateDiscipline: 1, avoidStrikeout: 1, speed: 9, baserunning: 7, fielding: 8, arm: 3 };
    case 'RF':
      return { contact: 1, power: 5, plateDiscipline: 0, avoidStrikeout: -1, speed: 1, baserunning: 0, fielding: 1, arm: 8 };
    case 'DH':
      return { contact: 4, power: 8, plateDiscipline: 3, avoidStrikeout: 1, speed: -12, baserunning: -10, fielding: -14, arm: -10 };
    default:
      return { contact: 0, power: 0, plateDiscipline: 0, avoidStrikeout: 0, speed: 0, baserunning: 0, fielding: 0, arm: 0 };
  }
};

const getPitcherPositionBias = (position: PlayerPosition) => {
  switch (position) {
    case 'SP':
      return { stuff: 2, command: 3, control: 3, movement: 1, stamina: 12, holdRunners: 1, fielding: 1 };
    case 'RP':
      return { stuff: 6, command: 1, control: 0, movement: 3, stamina: -10, holdRunners: 1, fielding: 0 };
    case 'CL':
      return { stuff: 8, command: 4, control: 1, movement: 4, stamina: -14, holdRunners: 2, fielding: 0 };
    default:
      return { stuff: 0, command: 0, control: 0, movement: 0, stamina: 0, holdRunners: 0, fielding: 0 };
  }
};

const getBatterOverall = (profile: Omit<BatterRatingsProfile, 'overall' | 'potentialOverall'>): number =>
  clampRating(
    profile.contact * 0.23 +
      profile.power * 0.2 +
      profile.plateDiscipline * 0.12 +
      profile.avoidStrikeout * 0.11 +
      profile.speed * 0.1 +
      profile.baserunning * 0.08 +
      profile.fielding * 0.1 +
      profile.arm * 0.06,
  );

const getPitcherOverall = (profile: Omit<PitcherRatingsProfile, 'overall' | 'potentialOverall'>): number =>
  clampRating(
    profile.stuff * 0.28 +
      profile.command * 0.19 +
      profile.control * 0.17 +
      profile.movement * 0.16 +
      profile.stamina * 0.12 +
      profile.holdRunners * 0.04 +
      profile.fielding * 0.04,
  );

const createBattingRatingsProfile = (player: Player, targetOverall: number, rng: RandomSource): BatterRatingsProfile => {
  const currentOverall = targetOverall;
  const potentialOverall = getPotentialOverall(player, currentOverall, rng);
  const bias = getBatterPositionBias(player.primaryPosition);
  const spread = player.status === 'prospect' ? 10 : 7;

  const rawProfile = alignBatterProfileOverall({
    contact: varyAttribute(currentOverall + bias.contact, spread, rng),
    power: varyAttribute(currentOverall + bias.power, spread, rng),
    plateDiscipline: varyAttribute(currentOverall + bias.plateDiscipline, spread, rng),
    avoidStrikeout: varyAttribute(currentOverall + bias.avoidStrikeout, spread, rng),
    speed: varyAttribute(currentOverall + bias.speed, spread, rng),
    baserunning: varyAttribute(currentOverall + bias.baserunning, spread, rng),
    fielding: varyAttribute(currentOverall + bias.fielding, spread, rng),
    arm: varyAttribute(currentOverall + bias.arm, spread, rng),
  }, currentOverall);

  return {
    ...rawProfile,
    overall: getBatterOverall(rawProfile),
    potentialOverall: Math.max(getBatterOverall(rawProfile), potentialOverall),
  };
};

const createPitchingRatingsProfile = (player: Player, targetOverall: number, rng: RandomSource): PitcherRatingsProfile => {
  const currentOverall = targetOverall;
  const potentialOverall = getPotentialOverall(player, currentOverall, rng);
  const bias = getPitcherPositionBias(player.primaryPosition);
  const spread = player.status === 'prospect' ? 10 : 7;

  const rawProfile = alignPitcherProfileOverall({
    stuff: varyAttribute(currentOverall + bias.stuff, spread, rng),
    command: varyAttribute(currentOverall + bias.command, spread, rng),
    control: varyAttribute(currentOverall + bias.control, spread, rng),
    movement: varyAttribute(currentOverall + bias.movement, spread, rng),
    stamina: varyAttribute(currentOverall + bias.stamina, spread, rng),
    holdRunners: varyAttribute(currentOverall + bias.holdRunners, spread, rng),
    fielding: varyAttribute(currentOverall + bias.fielding, spread, rng),
  }, currentOverall);

  return {
    ...rawProfile,
    overall: getPitcherOverall(rawProfile),
    potentialOverall: Math.max(getPitcherOverall(rawProfile), potentialOverall),
  };
};

const createBattingRatings = (player: Player, seasonYear: number, targetOverall: number, rng: RandomSource): PlayerBattingRatings => ({
  playerId: player.playerId,
  seasonYear,
  ...createBattingRatingsProfile(player, targetOverall, rng),
});

const createPitchingRatings = (player: Player, seasonYear: number, targetOverall: number, rng: RandomSource): PlayerPitchingRatings => ({
  playerId: player.playerId,
  seasonYear,
  ...createPitchingRatingsProfile(player, targetOverall, rng),
});

const getThrowHand = (primaryPosition: PlayerPosition, rng: RandomSource): 'L' | 'R' => {
  if (primaryPosition === 'SP' || primaryPosition === 'RP' || primaryPosition === 'CL') {
    return rng() < 0.28 ? 'L' : 'R';
  }
  return rng() < 0.12 ? 'L' : 'R';
};

const getBatHand = (primaryPosition: PlayerPosition, throws: 'L' | 'R', rng: RandomSource): 'L' | 'R' | 'S' => {
  if (primaryPosition === 'SP' || primaryPosition === 'RP' || primaryPosition === 'CL') {
    if (throws === 'L') {
      return rng() < 0.68 ? 'L' : 'R';
    }
    return rng() < 0.2 ? 'L' : 'R';
  }

  const roll = rng();
  if (roll < 0.1) {
    return 'S';
  }
  if (roll < 0.36) {
    return 'L';
  }
  return 'R';
};

const getSecondaryPosition = (primaryPosition: PlayerPosition, rng: RandomSource): PlayerPosition | null => {
  const options = SECONDARY_POSITION_MAP[primaryPosition] ?? [];
  if (options.length === 0 || rng() > 0.38) {
    return null;
  }
  return sample(options, rng);
};

const getYearsPro = (age: number, status: PlayerStatus, rng: RandomSource): number => {
  if (status === 'prospect') {
    return 0;
  }

  const baseline = Math.max(1, age - 21);
  const variance = randomInt(-2, 2, rng);
  return Math.max(1, baseline + variance);
};

const buildUniqueName = (
  usedFullNames: Set<string>,
  rng: RandomSource,
): { firstName: string; lastName: string } => {
  for (let attempt = 0; attempt < 5000; attempt += 1) {
    const pool = weightedChoice(
      HERITAGE_POOLS.map((entry) => ({ value: entry, weight: entry.weight })),
      rng,
    );
    const useWesternFirst = pool.westernFirstMixChance > 0 && rng() < pool.westernFirstMixChance;
    const firstName = sample(useWesternFirst ? WESTERN_FIRST : [...pool.firstNames], rng);
    const lastName = sample([...pool.lastNames], rng);
    const fullName = `${firstName} ${lastName}`;

    if (!usedFullNames.has(fullName)) {
      usedFullNames.add(fullName);
      return { firstName, lastName };
    }
  }

  throw new Error('Failed to generate a unique player name.');
};

const createPlayerFromBlueprint = (
  blueprint: PlayerBlueprint,
  seasonYear: number,
  usedFullNames: Set<string>,
  rng: RandomSource,
): Player => {
  const age = getAgeForBucket(blueprint.ageBucket, rng);
  const yearsPro = getYearsPro(age, blueprint.status, rng);
  const draftClassYear = blueprint.status === 'prospect' ? seasonYear : Math.max(seasonYear - yearsPro, seasonYear - Math.max(age - 18, 1));
  const names = buildUniqueName(usedFullNames, rng);
  const throws = getThrowHand(blueprint.primaryPosition, rng);
  const bats = getBatHand(blueprint.primaryPosition, throws, rng);
  const bio = generatePlayerBio(blueprint.primaryPosition, blueprint.status, age, rng);

  return {
    playerId: createUuid(),
    teamId: blueprint.teamId,
    firstName: names.firstName,
    lastName: names.lastName,
    playerType: blueprint.primaryPosition === 'SP' || blueprint.primaryPosition === 'RP' || blueprint.primaryPosition === 'CL' ? 'pitcher' : 'batter',
    primaryPosition: blueprint.primaryPosition,
    secondaryPosition: getSecondaryPosition(blueprint.primaryPosition, rng),
    bats,
    throws,
    age,
    height: bio.height,
    weightLbs: bio.weightLbs,
    potential: getPotential(blueprint.status, blueprint.ageBucket, rng),
    status: blueprint.status,
    contractYearsLeft: bio.contractYearsLeft,
    draftClassYear,
    draftRound: blueprint.status === 'prospect' ? null : randomInt(1, 20, rng),
    yearsPro,
    retirementYear: null,
  };
};

const createEmptyBattingStat = (playerId: string, seasonYear: number): PlayerSeasonBatting => ({
  playerId,
  seasonYear,
  seasonPhase: 'regular_season',
  gamesPlayed: 0,
  plateAppearances: 0,
  atBats: 0,
  runsScored: 0,
  hits: 0,
  doubles: 0,
  triples: 0,
  homeRuns: 0,
  walks: 0,
  strikeouts: 0,
  rbi: 0,
  avg: 0,
  ops: 0,
});

const createEmptyPitchingStat = (playerId: string, seasonYear: number): PlayerSeasonPitching => ({
  playerId,
  seasonYear,
  seasonPhase: 'regular_season',
  wins: 0,
  losses: 0,
  saves: 0,
  games: 0,
  gamesStarted: 0,
  inningsPitched: 0,
  hitsAllowed: 0,
  earnedRuns: 0,
  walks: 0,
  strikeouts: 0,
  era: 0,
  whip: 0,
});

const getReservePrimaryPosition = (reserveIndex: number, rng: RandomSource): PlayerPosition =>
  reserveIndex < RESERVE_BATTER_SLOTS_PER_TEAM
    ? sample(BATTING_POSITIONS, rng)
    : weightedChoice(RESERVE_PITCHER_POSITION_WEIGHTS, rng);

const getActiveRosterBlueprints = (teams: Team[], rng: RandomSource): PlayerBlueprint[] => {
  const ageBuckets = shuffle(getActiveAgeBuckets(teams.length * (CORE_ROSTER_SLOTS.length + RESERVE_ROSTER_SLOTS.length)), rng);

  let ageIndex = 0;

  return teams.flatMap((team) =>
    [
      ...CORE_ROSTER_SLOTS.map((slotCode) => ({
        status: 'active' as const,
        ageBucket: ageBuckets[ageIndex++] ?? 'peak',
        primaryPosition: SLOT_TO_PRIMARY_POSITION[slotCode],
        teamId: team.id,
        slotCode,
      })),
      ...RESERVE_ROSTER_SLOTS.map((slotCode, reserveIndex) => ({
        status: 'active' as const,
        ageBucket: ageBuckets[ageIndex++] ?? 'peak',
        primaryPosition: getReservePrimaryPosition(reserveIndex, rng),
        teamId: team.id,
        slotCode,
      })),
    ],
  );
};

const getTargetPositionCounts = (activeBlueprints: PlayerBlueprint[]): Record<PlayerPosition, number> => {
  const batterTargets = distributeEvenly(BATTING_POSITIONS, SUPPLEMENTAL_BATTER_COUNT);
  const activeCounts = activeBlueprints.reduce(
    (counts, blueprint) => {
      counts[blueprint.primaryPosition] += 1;
      return counts;
    },
    {
      C: 0,
      '1B': 0,
      '2B': 0,
      '3B': 0,
      SS: 0,
      LF: 0,
      CF: 0,
      RF: 0,
      DH: 0,
      SP: 0,
      RP: 0,
      CL: 0,
    } as Record<PlayerPosition, number>,
  );

  return {
    C: activeCounts.C + batterTargets.C,
    '1B': activeCounts['1B'] + batterTargets['1B'],
    '2B': activeCounts['2B'] + batterTargets['2B'],
    '3B': activeCounts['3B'] + batterTargets['3B'],
    SS: activeCounts.SS + batterTargets.SS,
    LF: activeCounts.LF + batterTargets.LF,
    CF: activeCounts.CF + batterTargets.CF,
    RF: activeCounts.RF + batterTargets.RF,
    DH: activeCounts.DH + batterTargets.DH,
    SP: activeCounts.SP + SUPPLEMENTAL_PITCHER_TARGETS.SP,
    RP: activeCounts.RP + SUPPLEMENTAL_PITCHER_TARGETS.RP,
    CL: activeCounts.CL + SUPPLEMENTAL_PITCHER_TARGETS.CL,
  };
};

const getRemainingPositionPool = (activeBlueprints: PlayerBlueprint[], rng: RandomSource): PlayerPosition[] => {
  const targetCounts = getTargetPositionCounts(activeBlueprints);

  activeBlueprints.forEach((blueprint) => {
    targetCounts[blueprint.primaryPosition] -= 1;
  });

  return shuffle(
    (Object.entries(targetCounts) as Array<[PlayerPosition, number]>).flatMap(([position, count]) =>
      Array.from({ length: count }, () => position),
    ),
    rng,
  );
};

const getSupplementalBlueprints = (activeBlueprints: PlayerBlueprint[], rng: RandomSource): PlayerBlueprint[] => {
  const remainingPositions = getRemainingPositionPool(activeBlueprints, rng);
  const prospectPositions = remainingPositions.slice(0, DEFAULT_PROSPECT_POOL_SIZE);
  const freeAgentPositions = remainingPositions.slice(DEFAULT_PROSPECT_POOL_SIZE, DEFAULT_SUPPLEMENTAL_POOL_SIZE);
  const freeAgentAgeBuckets = shuffle(buildBucketPool(FREE_AGENT_AGE_BUCKETS), rng);

  const prospectBlueprints: PlayerBlueprint[] = prospectPositions.map((position) => ({
    status: 'prospect',
    ageBucket: 'prospect',
    primaryPosition: position,
    teamId: null,
    slotCode: null,
  }));

  const freeAgentBlueprints: PlayerBlueprint[] = freeAgentPositions.map((position, index) => ({
    status: 'free_agent',
    ageBucket: freeAgentAgeBuckets[index] ?? 'peak',
    primaryPosition: position,
    teamId: null,
    slotCode: null,
  }));

  return [...prospectBlueprints, ...freeAgentBlueprints];
};

const buildOverallBaselineMap = (players: Player[], rng: RandomSource): Map<string, number> => {
  const playersByStatus: Record<PoolStatus, Player[]> = {
    active: shuffle(players.filter((player) => player.status === 'active'), rng),
    free_agent: shuffle(players.filter((player) => player.status === 'free_agent'), rng),
    prospect: shuffle(players.filter((player) => player.status === 'prospect'), rng),
  };
  const statusIndexes: Record<PoolStatus, number> = {
    active: 0,
    free_agent: 0,
    prospect: 0,
  };
  const baselineMap = new Map<string, number>();

  PLAYER_POOL_TIER_QUOTAS.forEach((quota) => {
    (Object.keys(quota.counts) as PoolStatus[]).forEach((status) => {
      const count = quota.counts[status];
      for (let index = 0; index < count; index += 1) {
        const player = playersByStatus[status][statusIndexes[status]];
        statusIndexes[status] += 1;
        if (!player) {
          continue;
        }
        baselineMap.set(player.playerId, sampleTierOverall(quota.min, quota.max, rng));
      }
    });
  });

  players.forEach((player) => {
    if (!baselineMap.has(player.playerId)) {
      const fallbackTier = pickOverallTier(player, rng);
      baselineMap.set(player.playerId, sampleTierOverall(fallbackTier.min, fallbackTier.max, rng));
    }
  });

  return baselineMap;
};

export const generatePlayerPool = (
  teams: Team[],
  seasonYear: number,
  rng: RandomSource = DEFAULT_RANDOM,
): LeaguePlayerState => {
  const activeBlueprints = getActiveRosterBlueprints(teams, rng);
  const supplementalBlueprints = getSupplementalBlueprints(activeBlueprints, rng);
  const usedFullNames = new Set<string>();
  const allPlayers = [...activeBlueprints, ...supplementalBlueprints].map((blueprint) =>
    createPlayerFromBlueprint(blueprint, seasonYear, usedFullNames, rng),
  );
  const overallBaselineMap = buildOverallBaselineMap(allPlayers, rng);

  const rosterSlots: TeamRosterSlot[] = allPlayers
    .filter((player, index) => activeBlueprints[index]?.slotCode)
    .map((player, index) => ({
      seasonYear,
      teamId: activeBlueprints[index].teamId as string,
      slotCode: activeBlueprints[index].slotCode as RosterSlotCode,
      playerId: player.playerId,
    }));

  const battingStats: PlayerSeasonBatting[] = allPlayers
    .filter((player) => player.playerType === 'batter')
    .map((player) => createEmptyBattingStat(player.playerId, seasonYear));

  const pitchingStats: PlayerSeasonPitching[] = allPlayers
    .filter((player) => player.playerType === 'pitcher')
    .map((player) => createEmptyPitchingStat(player.playerId, seasonYear));

  const battingRatings: PlayerBattingRatings[] = allPlayers
    .filter((player) => player.playerType === 'batter')
    .map((player) => createBattingRatings(player, seasonYear, overallBaselineMap.get(player.playerId) ?? 75, rng));

  const pitchingRatings: PlayerPitchingRatings[] = allPlayers
    .filter((player) => player.playerType === 'pitcher')
    .map((player) => createPitchingRatings(player, seasonYear, overallBaselineMap.get(player.playerId) ?? 75, rng));

  return {
    players: allPlayers,
    battingStats,
    pitchingStats,
    battingRatings,
    pitchingRatings,
    rosterSlots,
    transactions: [],
  };
};

export const shouldGenerateDraftClass = (
  players: Player[],
  threshold = DEFAULT_PLAYER_REPLENISHMENT_THRESHOLD,
): boolean =>
  players.filter((player) => player.status === 'active' || player.status === 'free_agent').length < threshold;

export const generateDraftClass = (
  seasonYear: number,
  count = DEFAULT_DRAFT_CLASS_SIZE,
  rng: RandomSource = DEFAULT_RANDOM,
): Player[] => {
  const targetCounts: Record<PlayerPosition, number> = {
    ...distributeEvenly(BATTING_POSITIONS, SUPPLEMENTAL_BATTER_COUNT),
    ...SUPPLEMENTAL_PITCHER_TARGETS,
  };
  const usedFullNames = new Set<string>();
  const weightedPositions: Array<WeightedEntry<PlayerPosition>> = [
    ...Object.entries(targetCounts).map(([position, weight]) => ({
      value: position as PlayerPosition,
      weight,
    })),
  ];

  return Array.from({ length: count }, () => {
    const player = createPlayerFromBlueprint(
      {
        status: 'prospect',
        ageBucket: 'prospect',
        primaryPosition: weightedChoice(weightedPositions, rng),
        teamId: null,
        slotCode: null,
      },
      seasonYear,
      usedFullNames,
      rng,
    );

    return {
      ...player,
      age: randomInt(18, 20, rng),
      yearsPro: 0,
      draftClassYear: seasonYear,
    };
  });
};
